# Architectural Review — Parcel Perfect API, Handshake Model, Driver App & Custody Ledger

> **Status:** review / design input — no code changed by this document.
> **Author:** Ciaran (with Claude as reviewing architect) · **Date:** 2026-07-02
> **Sources read (directly, not via the graph — graphify build of 27 Jun is stale in places):**
> `FreightProof_Full_Picture_v7.md`, `superpowers/plans/2026-06-24-fp112-tripstop.md`, both
> `design-notes/2026-06-24-*` files, all six Bruce meeting-minute sets + `iter2_kickoff_meeting.md`,
> the full `parcel_perfect_documentation/` set (v28 doc, 12 endpoint CSVs, Postman collection), and
> the live source: `db/models/trips.py`, `db/models/handshakes.py`, `db/models/enums.py`,
> `schemas/handshakes.py`, `orchestration/handshake_service.py`, `orchestration/manifest_service.py`,
> `driver-pwa/` (routes, handshake flow, offline queue), `frontend/shared/lib/constants/handshake-meta.ts`.
> **Audience:** whole team. Driver-app findings are review input for Tim, not edits to his branch.

---

## 0. TL;DR — the findings that change what we do next

1. **We have documentation for the wrong Parcel Perfect API surface.** What's in the repo is
   **ecomService v28** — PP's own overview calls it *"a web services interface between an
   ecommerce site and a Parcel Perfect environment"* for **quotes and collection bookings**.
   It has **no manifest endpoint, no scan-event endpoint, and no scan-in/scan-out status**.
   Full Picture v7 §8.1 assumes all three exist. This reshapes the three-party negotiation ask
   (see §4.4) and what our iteration-2 mocks may honestly pretend the API can do.
2. **The handshake implementation has drifted from the design in ways that weaken the evidence
   claim** — most seriously: the driver *types in* the PP scan-in count at H5
   (`H5CompleteRequest.pp_scan_in_count`), which both leaks manifest-grain data to the driver and
   collapses the "three independent counts" into one source. Full findings in §6.
3. **The five-handshake model is single-seal-shaped and hard-wired at every layer** (enum order,
   `TripStatus` doubling as the state machine, `UNIQUE(trip_id, handshake_type)`, fixed-length
   frontend records). §7 sets out the per-stop structure it should converge to, and the
   degenerate-case migration path.
4. **"The waybill tells us what's in the truck and when"** is best modelled as a **custody
   ledger**: waybill snapshots hashed into each LOAD/UNLOAD handshake, plus per-consignment
   custody intervals bounded by seal segments. Design in §8 — it works with mock data now and
   with the real PP API later, unchanged.

---

# Part A — Parcel Perfect API review

## 1. What the ecomService v28 actually offers vs what v7 assumes

Documented endpoints: `getSalt`, `getSecureToken` (auth), `getPlacesByName`, `getPlacesByPostcode`,
`getDefItems`, `requestQuote`, `updateService`, `quoteToWaybill`, `quoteToCollection`,
`submitCollection`, `submitCompoundCollection`, `getSingleWaybill`.

| v7 §8.1 assumption | ecomService v28 reality |
|---|---|
| Consignment record (ID, client, origin, destination, unit count, declared value) | ✅ Mostly — `getSingleWaybill` returns pieces, `declaredvalue`, orig/dest details, `actkg`, `chargemass`, per waybill |
| Full manifest (unit/parcel breakdown, barcode, delivery-stop assignment) | ⚠️ Partial — `tracks` (per-parcel tracking numbers) and `contents` (freight lines) exist **per waybill**. There is **no manifest endpoint**: `manifest` is just an integer ("last manifest number") on a waybill. You cannot enumerate "all waybills on Manifest 69". |
| Scan-out status at loading / scan-in status at destination | ❌ Absent. No scan-event or status-history endpoint. v7 Handshake 2's three-state polling loop has **no programmatic source** here. |
| Slot times per leg | ⚠️ Only `duedate`/`duetime` per waybill — a due date, not a slot window. |
| Delivery stop details (multi-stop) | ⚠️ Indirect — `destlatitude`/`destlongitude`/`destplace` per waybill (genuinely useful, §1.2), but no stop/route concept. |

**API mechanics** (from the Postman collection): a single `POST {base}/ecomService/v28/Json/` with
form-urlencoded fields `method`, `class`, `params` (a JSON **string**), `token_id`. Responses are an
`errorcode`/`errormessage`/`results[]` envelope. Dates are `dd.mm.yyyy` strings. Auth is
`getSalt` → `md5(password+salt)` → `getSecureToken`; **tokens never expire** (cache per account).
The CSV type columns are demonstrably unreliable (e.g. `submitCollection.csv` types
`destpercontact` as *integer* and `currency` as *float* for a currency code) — parse defensively.

### 1.1 What this means

- The Handshake 2 "poll for scan-out status" and the system leg of the Handshake 5 three-count
  reconciliation **cannot be built on this surface**. Bruce (16 Apr) mentioned PP produces
  *collection reports and delivery reports* — those, or the operational API behind them, are what
  the negotiation must secure (§4.4).
- The manifest-at-sealing anchor (16 Apr insight) is only weakly observable: you can poll
  `getSingleWaybill` and watch `manifest` turn non-zero ("this waybill has been manifested"), but
  never see the manifest's composition or sealing moment.
- Iteration-2 mocks should mock the **real wire shape** (envelope, method/class/params) of the
  calls we *can* make, and be explicit about which data is "negotiation-pending".

### 1.2 Value we're not yet extracting from the API we *do* have

Per-waybill via `getSingleWaybill`:

- **`declaredvalue` → value-at-risk per trip.** Sum across consignments = a rand figure on every
  evidence chain and SLA report line ("R2.4M moved on this corridor, zero seal exceptions").
  Bruce's insurance argument (12.5% of cost/kg) turned into a number a broker can price. One
  snapshot field; highest commercial return available.
- **`destlatitude`/`destlongitude` → free stop-coordinate cross-check.** Validate against
  `TripStop.precinct` coordinates in the wizard, *before* the journey lock. Kills "wrong
  destination captured" errors at data entry.
- **`actkg`/`chargemass` → declared aggregate weight vs vehicle max legal weight** at trip
  creation. Makes v7 §9 (weigh-bridge/trimming) *visible*, still recorded-not-enforced.
- **`failtype`** (delivery failure reason) → PP-side corroboration of delivery exceptions.
- **`duedate`/`duetime`** → independent SLA reference locked into the journey hash.
- **Wizard-time reference validation** — a live `getSingleWaybill` when the dispatcher types a
  consignment reference catches typos before they enter the tamper-evident record.

Consciously *not* used: the quote/booking half of the API. It's operational, write-shaped, out of
scope.

## 2. Trip creation direction & read-only policy

**Rule: cargo is PP-first; the trip is FreightProof-first; nothing is ever written back.**

- **PP-first for cargo:** the order → consignment → waybill chain exists in the client's world
  before LFG is involved ("the journey starts by virtue of an order" — Bruce). FreightProof
  creating cargo records PP doesn't know about would make us a second source of truth — the exact
  fragmentation we exist to bridge.
- **FreightProof-first for the trip:** truck, driver, seal, route, stop order are LFG constructs;
  PP has no route/vehicle concept anywhere in its API. The trip is our native entity; the journey
  lock is its birth certificate.
- **Read-only, on three independent grounds:**
  1. *Commercial* — the whole three-party negotiation is premised on "FreightProof only reads"
     (Bruce, 24 Jun). One write endpoint and the framing collapses.
  2. *Architectural* — writes make us co-owner of cargo data → TMS territory that
     `scope-boundaries.md` fences off.
  3. *Evidentiary (strongest)* — an evidence system that can write to the system it audits cannot
     claim independence. Read-only is a **certifiable property**, not a limitation. Enforce it
     structurally: the PP client **omits** the write methods entirely (don't implement-and-guard).

**Wizard flow (FP-114 input):**
1. Order number (or template).
2. Consignments added by PP waybill reference → (mock now, live later) `getSingleWaybill`
   validates + prefills client, pieces, value, weight, dest coords, due date; snapshot into
   `pp_raw_json`. Dispatcher adds `unit_count_expected` and `load_priority`.
3. Stops auto-proposed from consignments' origin/destination precincts, ordered by slot time;
   dispatcher reorders. PP coords cross-checked inline.
4. Driver (IDVS re-run), horse, trailers (Pulsit snapshot), Pulsit trip ref.
5. Review (aggregate value + weight shown) → journey lock over trip + ordered stops +
   consignment↔stop assignments + PP snapshots (FP-113) → anchor.

The FP-112 A.6 principle holds: the *simple* flow is the same wizard emitting two auto-synthesised
stops. One code path.

## 3. Per-stop cargo tracking — polling logic

**Invert the question first.** "What is inside the truck" is *derived from our own committed plan
plus executed handshakes*, and PP **corroborates** it — never defines it:

```
onboard(after stop k) = { c ∈ consignments :
                          LOAD handshake at c.pickup_stop  is COMPLETE
                          and UNLOAD handshake at c.delivery_stop is NOT complete }
```

Use *executed* handshakes, not planned sequence — a consignment whose pickup stop was skipped is
not on the truck, and that divergence is itself an exception.

**Per-stop call flow (with ecomService as it exists):**

1. **Trip creation:** per consignment → `getSingleWaybill` → snapshot into `pp_raw_json`;
   `Parcel` rows from `tracks` (dispatcher-only reference data). Snapshot enters the journey lock.
2. **Gate-in at stop k** → select `due_deliveries = {c : delivery_stop = k}`,
   `due_pickups = {c : pickup_stop = k}`.
3. **Deliveries first:** re-poll each waybill (capture `manifest`, `failtype`, drift vs the locked
   snapshot — drift is a *recorded observation*, never a silent update). Driver executes UNLOAD
   with unit count; mismatch → `PARCEL_COUNT_MISMATCH` scoped to stop + consignment.
4. **Pickups:** re-poll (waybill exists; `manifest` non-zero = weak "manifested" signal). Driver
   executes LOAD with unit count.
5. **Reseal** → seal-segment chain extends (seal verified at k+1 must equal seal applied at k).
6. **Gate-out** → recompute `onboard()`; dispatcher timeline shows per-client truck contents.

**Mechanics:** Celery task polls only inside active stop windows (gate-in received, handshake
incomplete), interval as a config constant (`PP_POLL_INTERVAL_SECONDS`), backoff on
`errorcode != 0`, one cached token per PP account. Never poll all trips continuously.

**Honesty note:** with ecomService alone the "scan complete" signal doesn't exist — the *system*
leg of reconciliation is degraded to snapshot-vs-snapshot plus the manifest-number heuristic.
Driver count + dispatcher confirmation carry it until the negotiation lands operational data.
Write this into the iter-2 mock docs so the demo doesn't over-claim.

## 4. Structural refactors pulled in behind FP-112

### 4.1 Already known (confirming our own docs)
- **FP-113** — journey lock must cover ordered stops **+ consignment↔stop assignments + the PP
  snapshot** (waybill no, pieces, value, weight), so the committed *cargo plan* is tamper-evident,
  not just the route.
- **Per-stop handshakes** ticket (design-note Option A) + the deferred
  `HandshakeEvent.trip_stop_id` migration. See §7 for the concrete target.
- **FP-114** wizard (§2).

### 4.2 Not yet on anyone's list
1. **Exception scoping columns** — nullable `consignment_id` + `trip_stop_id` FKs on the exception
   model. Without them the multi-client evidence PDF can't be cut per client (v7 §6.1: "a FedEx
   discrepancy should not surface in Courier Guy's evidence chain").
2. **Consignment PP-reference upgrade** — `parcel_perfect_reference` is explicitly the **waybill
   number** (≤24 chars); add snapshotted `pp_manifest_number: int | None` and eventually a PP
   account/instance key. Bundle into FP-112's consignment migration if possible.
3. **`unit_count_expected` on `Consignment`** — the custody/linehaul grain is **consolidated
   units** (Bruce 24 Jun), which nothing stores today. Tim's linehaul depends on it (see F2).
4. **PP client registry in config** — N named credential sets (per client org + branch), not
   `PP_USERNAME`/`PP_PASSWORD` singletons. Origin and destination may be separate PP instances
   (v7 §8.1); FedEx/Courier Guy/Seaborne each have their own accounts. Shared file — coordinate.
5. **`TripTemplate` multi-stop** — currently hard-codes single client + origin/destination
   defaults. Defer, but say so in FP-114 so the wizard doesn't build two-stop-only template logic.
6. **Dispatcher timeline groups by stop**; **driver PWA becomes plan-driven** (§7.3) — no
   hard-coded array-length-5 anywhere in `driver-pwa/` or `frontend/shared/` handshake meta.
7. **SLA metrics per stop** — slot compliance moves to per-stop `slot_time`.
8. **Simulation harness (FP-116) must simulate N-stop trips** or the demo can't show FP-112.
9. **Return-leg link** — `Trip.return_of_trip_id` nullable FK (v7 §14.3).
10. **`Parcel.delivery_stop` is a free string** (`trips.py:87`) — becomes an FK to `TripStop`
    when stops exist.

### 4.3 Build `integrations/parcel_perfect.py` mock-first, now
There is currently **no PP integration module at all** (`integrations/` holds only
`supabase_admin.py`). Create the client in iteration 2 with the *real transport shape* (single
POST, `method`/`class`/`params`-as-JSON-string, token lifecycle, §5 models) backed by canned
envelopes. That makes "mock data shaped like the real PP API" (v7 §12) literally true at the wire
level, turns live cutover into a config change, and demos credibly in the PP negotiation.

### 4.4 The negotiation ask list (the deliverable Bruce requested on 24 Jun)
Request, in priority order — all read-only, all keyed by waybill/manifest references FedEx already
shares with LFG:
1. **Manifest contents by manifest number** (waybill list + piece/unit counts).
2. **Scan event history per waybill** (or tracking number) with timestamps + facility.
3. **Destination scan-in status per waybill.**
4. Slot/booking windows if they exist server-side.
5. Failing the above: scheduled exports of PP's *collection/delivery reports*, or webhooks.

## 5. Draft PP Pydantic models + mapping (reference implementation)

Grounded in the CSVs, the Postman wire format, and the real `Consignment` model. Design drivers:
the RPC envelope, and defensive coercion because the CSV types are unreliable.

```python
"""Pydantic v2 models for the Parcel Perfect ecomService v28 JSON endpoint.

Wire format (per Postman collection): a single POST of form-urlencoded
fields — method, class, params (JSON *string*), token_id — to
{base}/ecomService/v28/Json/. Responses are an envelope of
errorcode / errormessage / results[]. Dates arrive as dd.mm.yyyy strings.

Read-only by design: only Auth + lookup methods are modelled. The write
half of ecomService (quotes, collections) is deliberately not implemented —
FreightProof's evidentiary independence depends on never writing to the
system it observes.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

PP_DATE_FORMAT = "%d.%m.%Y"          # dd.mm.yyyy per the CSVs
PP_TIME_FORMAT = "%H:%M:%S"


class PPModel(BaseModel):
    """Base for all PP payloads: tolerate the API's loose typing."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


ResultT = TypeVar("ResultT", bound=PPModel)


class PPResponseError(Exception):
    """Non-zero errorcode from PP — log and raise, never swallow."""

    def __init__(self, errorcode: int, errormessage: str) -> None:
        self.errorcode = errorcode
        self.errormessage = errormessage
        super().__init__(f"Parcel Perfect error {errorcode}: {errormessage}")


class PPEnvelope(PPModel, Generic[ResultT]):
    """Standard errorcode/errormessage/results wrapper on every response."""

    errorcode: int = 0
    errormessage: str | None = None
    results: list[ResultT] | None = None

    @property
    def ok(self) -> bool:
        return self.errorcode == 0

    def single(self) -> ResultT:
        # The PP docs guarantee a single element when results is non-null.
        if not self.ok or not self.results:
            raise PPResponseError(self.errorcode, self.errormessage or "empty results")
        return self.results[0]


class PPSalt(PPModel):
    salt: str


class PPToken(PPModel):
    tokenid: str  # SHA1, valid indefinitely per PP docs — cache per account


class PPContentLine(PPModel):
    """One contents line on a waybill (consolidated freight line, not a parcel)."""

    item: int
    pieces: int
    description: str = ""
    dim1: float | None = None
    dim2: float | None = None
    dim3: float | None = None
    actmass: float | None = None
    defitem: int | None = None


class PPTrackingEntry(PPModel):
    """Per-parcel tracking number — maps onto FreightProof's Parcel (reference data)."""

    trackno: str
    parcelno: int
    item: int | None = None  # >0 links back to a contents line


class PPWaybillReference(PPModel):
    reference: str
    pageno: int = 1


class PPWaybillDetails(PPModel):
    """The [details] block of getSingleWaybill — only fields FreightProof uses;
    everything else stays in the raw JSON we persist alongside."""

    waybill: str
    service: str | None = None
    waydate: date | None = None
    duedate: date | None = None
    accnum: str | None = None
    custname: str | None = None
    origpers: str | None = None
    origtown: str | None = None
    destpers: str | None = None
    desttown: str | None = None
    destlatitude: float | None = None
    destlongitude: float | None = None
    pieces: int | None = None
    actkg: float | None = None
    chargemass: float | None = None
    declaredvalue: Decimal | None = None
    insuranceflag: int | None = None
    reference: str | None = None
    manifest: int | None = None   # "last manifest number" — weak manifested signal
    failtype: str | None = None   # delivery failure reason → exception corroboration

    @field_validator("waydate", "duedate", mode="before")
    @classmethod
    def parse_pp_date(cls, v: object) -> object:
        # PP sends dd.mm.yyyy strings; empty string means absent.
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            return datetime.strptime(v, PP_DATE_FORMAT).date()
        return v


class PPSingleWaybillResult(PPModel):
    """results[0] of getSingleWaybill: details + contents + tracks + wayref."""

    details: list[PPWaybillDetails]
    contents: list[PPContentLine] = Field(default_factory=list)
    tracks: list[PPTrackingEntry] = Field(default_factory=list)
    wayref: list[PPWaybillReference] = Field(default_factory=list)

    @property
    def detail(self) -> PPWaybillDetails:
        if not self.details:
            raise PPResponseError(0, "waybill result contained no details block")
        return self.details[0]
```

Mapping to FreightProof drafts (orchestration persists; `integrations/` stays session-free; stop
*linking* stays in orchestration where `TripStop` rows exist):

```python
"""Translate a PP getSingleWaybill response into FreightProof draft records.

PP is corroboration, not source of truth: precinct identity and the client
organisation come from the dispatcher's committed selections; PP supplies
the cargo facts we snapshot into the journey lock.
"""

import uuid

from pydantic import BaseModel, ConfigDict


class ParcelDraft(BaseModel):
    model_config = ConfigDict(frozen=True)

    barcode: str                           # PP trackno
    description: str | None                # joined from the linked contents line


class ConsignmentDraft(BaseModel):
    model_config = ConfigDict(frozen=True)

    parcel_perfect_reference: str          # the waybill number
    client_organization_id: uuid.UUID
    origin_precinct_id: uuid.UUID | None
    destination_precinct_id: uuid.UUID | None
    declared_value: float | None
    parcel_count_expected: int | None      # PP pieces (parcel grain, dispatcher-only)
    unit_count_expected: int | None        # consolidated units — dispatcher-entered;
                                           # PP cannot supply this (pallet grain is LFG's)
    slot_time_destination: str | None      # ISO; PP duedate is corroboration only
    pp_manifest_number: int | None
    pp_dest_latitude: float | None         # cross-check vs TripStop precinct coords
    pp_dest_longitude: float | None
    pp_raw_json: dict[str, object]         # full envelope snapshot → journey lock
    parcels: tuple[ParcelDraft, ...]


def map_waybill_to_consignment(
    envelope: PPEnvelope[PPSingleWaybillResult],
    *,
    client_organization_id: uuid.UUID,
    origin_precinct_id: uuid.UUID | None,
    destination_precinct_id: uuid.UUID | None,
    unit_count_expected: int | None,
) -> ConsignmentDraft:
    """Build the Consignment draft the wizard confirms before journey lock.

    Raises PPResponseError on a non-zero errorcode — an invalid reference must
    fail loudly at data entry, before it can enter the tamper-evident record.
    """
    result = envelope.single()
    d = result.detail

    contents_by_item = {line.item: line for line in result.contents}
    parcels = tuple(
        ParcelDraft(
            barcode=track.trackno,
            description=(
                contents_by_item[track.item].description
                if track.item is not None and track.item in contents_by_item
                else None
            ),
        )
        for track in result.tracks
    )

    return ConsignmentDraft(
        parcel_perfect_reference=d.waybill,
        client_organization_id=client_organization_id,
        origin_precinct_id=origin_precinct_id,
        destination_precinct_id=destination_precinct_id,
        declared_value=float(d.declaredvalue) if d.declaredvalue is not None else None,
        parcel_count_expected=d.pieces,
        unit_count_expected=unit_count_expected,
        slot_time_destination=d.duedate.isoformat() if d.duedate else None,
        pp_manifest_number=d.manifest if d.manifest else None,
        pp_dest_latitude=d.destlatitude,
        pp_dest_longitude=d.destlongitude,
        pp_raw_json=envelope.model_dump(mode="json"),
        parcels=parcels,
    )
```

Implementation notes: (a) MD5 auth is PP's design — isolate inside the client, never log
credential material; (b) `params` must be a JSON **string** inside form-urlencoded data — with
httpx use `data=`, not `json=`; (c) `unit_count_expected` / `pp_manifest_number` assume the §4.2
migration lands with/after FP-112.

---

# Part B — Driver app & handshake model: source-level audit

## 6. Findings (what is currently — sometimes subtly — wrong)

Severity: 🔴 breaks the evidence claim or a hard domain rule · 🟠 blocks multi-stop / known-next
work · 🟡 quality/consistency.

### F1 🔴 The driver types the PP scan-in count (`H5CompleteRequest.pp_scan_in_count`)
`schemas/handshakes.py:152`, consumed at `handshake_service.py:211-219`. Two independent problems:
- **Leaks manifest-grain data to the driver.** For the driver to type the PP count, someone must
  show them the PP count — violating the linehaul boundary (Bruce's hard line, 24 Jun).
- **Destroys source independence.** The "three-count reconciliation" becomes: driver's H2 visual
  count vs driver's H5 visual count vs a number the driver typed. Three counts, one source. The
  corruption-resistance argument in v7 §11 rests on counts coming from *independent* parties.

**Fix direction:** the PP/system leg must be **server-fetched** (mock manifest service now, PP
corroboration later). The driver's H5 flow submits only their visual count; reconciliation runs
server-side; the UI's "Reconciliation" step becomes a waiting/result screen, not an input.

### F2 🔴 The linehaul shows a *parcel* count, not a consolidated *unit* count
`manifest_service.py:85`: `consolidated_unit_count=len(parcels)`. This is literally the mistake
the 24 Jun coordination note called out ("the count is **consolidated units**, not parcels").
It's also the wrong number for the driver to verify against — the driver counts pallets, not
shrink-wrapped contents. Root cause: no `unit_count_expected` field exists anywhere (§4.2 item 3).
The linehaul response is also missing **seal number(s)** and **vehicle configuration/trailers**,
which v7 §8.1 defines as linehaul content. (Seal is only known mid-H2 in the digital flow — the
linehaul document should re-render with the seal after capture, matching the printed original
which is produced *after* sealing.)

### F3 🔴 Manifest/linehaul services assume exactly one consignment per trip
`manifest_service.py:22`: `scalar_one_or_none()` on `Consignment.trip_id == trip_id` — with two
consignments this **raises `MultipleResultsFound`** (a 500, not even a graceful wrong answer).
Multi-client is confirmed standard practice (24 Jun). Every consumer of "the consignment" needs a
per-consignment loop; the dispatcher manifest becomes a list grouped by client; the linehaul sums
unit counts across consignments.

### F4 🔴 The anchored event hash covers almost none of the evidence
`handshake_service.py:114-117` (H2) hashes only `{trip_id, seal_number, driver_visual_count}`;
H5 only `{trip_id, pp_scan_in_count, driver_visual_count}`. Not covered: the waybill photo, seal
photo, POD photo/signature, GPS coordinates, timestamps, or the manifest snapshot. Since
`EvidenceArtifact.file_hash` already exists (`evidence.py:36`), the canonical event payload should
fold in the **artifact SHA-256s** + GPS + timestamps + (H2) the PP/manifest snapshot hash. Right
now, anchoring the event hash to Hedera would make the *photos replaceable without detection* —
the exact attack the system exists to prevent. Anchoring itself is deferred (documented honestly
in the module docstring) — fix the hash shape **before** wiring the anchor, so receipts never have
to be re-explained.

### F5 🟠 H3's seal verification evidence is discarded
`H3CompleteRequest.guard_verified_seal: bool` is accepted and then **never persisted** —
`advance_h3` writes only the gate photo. The frontend collects it (step `2-exit-and-seal`). v7
says the guard verifies the seal at gate-out and the driver captures it. Either persist it (plus
optionally the seal number re-read) on the H3 event, or drop it from the schema — a silently
ignored field is worse than either.

### F6 🟠 `parcel_manifest_snapshot` and `parcel_count_origin` are never populated
The columns exist on `HandshakeEvent` but no code writes them. H2 completes without snapshotting
what the system-of-record said was loaded — so H5's "origin count" falls back to the driver's H2
visual count (`handshake_service.py:206`). Even in mock mode, H2 should persist the manifest
snapshot + system origin count so the reconciliation actually has a system leg (and the snapshot
feeds the custody ledger, §8).

### F7 🟠 `EXCEPTION_HOLD` is a one-way door
`advance_h4` sets `trip.status = EXCEPTION_HOLD` on seal mismatch, and `advance_h5` requires
`DEST_GATE_IN`. As far as I can find, **no code path returns a trip from `EXCEPTION_HOLD`** — the
`dispatcher_override_*` columns exist but nothing writes them. v7 §5 requires exactly this
override ("seal-intact failure requires dispatcher override before the trip can proceed"). A held
trip is currently un-closeable. Needs a dispatcher resume/override endpoint that records the
override user + note on the handshake event and restores the appropriate status.

### F8 🟠 The five-handshake shape is hard-wired at four layers (multi-stop blockers)
1. **`TripStatus` doubles as the handshake state machine** — `_load_trip_for_handshake` chains on
   `expected_status` equality, so the trip status enum *is* the sequencer. Our own design note
   (§5, multi-stop handshakes) says `TripStatus` must stay coarse. See §7.1.
2. **`UNIQUE(trip_id, handshake_type)`** (`handshakes.py:25`) — permits exactly one LOADING per
   trip, ever. Multi-stop needs `(trip_id, trip_stop_id, handshake_type)`.
3. **`sequence_number = list(HandshakeType).index(...)`** (`handshake_service.py:61`) — enum
   declaration order is load-bearing wire data.
4. **Frontend fixed-length records** — `HANDSHAKE_STEP_COUNTS: Record<HandshakeNumber, number>`,
   `STAGE_NUMBERS = [1,2,3,4,5]`, `HandshakeNumber = 0|1|2|3|4|5`. Fine for iter-2; must become
   plan-driven (§7.3) rather than grown into `0|1|...|11`.

### F9 🟠 Offline queue replays collide with strict server sequencing
`useOfflineQueue` re-submits queued handshakes on reconnect; the server raises
`HandshakeSequenceError` whenever `trip.status` isn't the expected value. A duplicate replay of an
already-applied completion (double-tap, retry after a timeout whose response was lost) gets a hard
error the driver can't interpret. Handshake completion should be **idempotent**: re-submitting an
already-completed handshake with the same evidence returns the current trip state (200), not an
error. An idempotency key (client-generated per queue entry — the queue already has `id`) is the
clean mechanism. Also note: N3 dead zones are the *normal* case, so this path is not an edge case.

### F10 🟡 BQ2's resolution contradicts Full Picture v7 — update the doc
`handshakes.py:68-70`: *"BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
signature."* v7 §15.4 still says the driver digital signature was *removed* and there is "no
digital co-sign on driver's screen". The code is ahead of the doc. Update v7 (and note it's the
**cargo officer** signing on the driver's device — Bruce's 26 Mar "touch-on-glass" supports this,
but it should be explicitly confirmed at the July site visit since it changes what we ask
warehouse staff to physically do).

### F11 🟡 Status-name semantics + small inconsistencies
- After H2 completes, `trip.status = LOADING` — but loading has just *finished*. The status names
  describe the last completed handshake, not the current phase. Harmless until someone builds
  logic on the natural-language meaning; §7.1 removes the issue entirely.
- `advance_h4` sets `completed_at` even on the exception path (arguably fine — the *attempt*
  completed — but be deliberate).
- Count fields are parcel-named (`parcel_count_origin/destination`) but must be **unit**-grain
  (24 Jun). Rename or alias when the per-stop migration lands, so the evidence vocabulary matches
  the glossary.

### What the driver app gets **right** (keep these)
- **URL-as-state step navigation** (`nextHandshakeRoute` is a pure function of the URL; refresh
  and deep links can't desync) with loud failure on unknown slugs.
- **Current-handshake-only** design — matches "the app only offers the next valid handshake".
- **Capture components are already generic** (`CameraCapture`, `SealInput`, `GpsCapture`,
  `SignaturePad`, `EvidenceReview`) — exactly the reusable per-stop blocks §7 needs.
- Offline queue exists with sensible storage-failure handling; panic is just an exception type.
- `handshakeProgress` derives from per-handshake records, not `trip.status` — that's the right
  instinct that §7.1 generalises.

## 7. How handshakes should most likely be structured

This extends `design-notes/2026-06-24-multi-stop-handshakes.md` (Option A) with the concrete
target, informed by the F-findings. Iteration-3+ execution; iteration-2 job is only to *not paint
over the door*.

### 7.1 Trip status goes coarse; the handshake ledger becomes the state machine
```
TripStatus:  CREATED → ACTIVE → CLOSED   (+ CANCELLED, EXCEPTION_HOLD)
```
"Where is the truck in the lifecycle" is **derived** from the handshake event ledger, not stored
in an enum. The server computes and serves the **next valid handshake** for the trip
(`GET /trips/{id}/next-handshake` conceptually) — this is what makes the driver app plan-driven
(§7.3) and is the single change that unblocks multi-stop sequencing. The current
`expected_status` chaining becomes: "the previous handshake in the plan is COMPLETED (or
OVERRIDDEN), and no EXCEPTION_HOLD is active."

### 7.2 Per-stop handshake types with seal segments
```
Trip-level:   TRIP_CREATION (H0, dispatcher)
Per stop k:   STOP_GATE_IN → [UNLOAD, per due consignment] → [LOAD, per due consignment]
              → STOP_SEAL (reseal, new number) → STOP_GATE_OUT
Final stop:   no reseal / gate-out — closes the trip
```
- `HandshakeEvent.trip_stop_id` (nullable FK) + uniqueness `(trip_id, trip_stop_id,
  handshake_type)`; `sequence_number` assigned from the committed plan, not enum order (F8.3).
- **Seal segments:** `seal_in` on `STOP_GATE_IN` must equal `seal_out` of stop k−1's
  `STOP_SEAL`. Mismatch → `SEAL_MISMATCH` scoped to the leg. Every leg becomes independently
  provable — a property the single-seal trip doesn't even have.
- **Cargo verification is per consignment** — UNLOAD/LOAD events carry (or link to) one custody
  row per consignment (§8), each with its own unit-count check and per-consignment exception
  scoping.
- **Degenerate mapping** (today's demo path, one code path forever):
  stop 0 = `{GATE_IN, LOAD, SEAL, GATE_OUT}`, stop 1 = `{GATE_IN, UNLOAD, close}` — exactly the
  current H1–H5 with new names. The existing seal comparison (H4 vs H2) becomes the general
  segment rule's 2-stop instance.
- Evidence weighting stays asymmetric (arrival > departure) by policy, unchanged.

### 7.3 Driver app: from fixed enum walk to plan-driven sequence (input for Tim)
No rewrite needed — the pieces are already right-shaped:
1. **Fetch the plan, don't hard-code it.** Replace `Record<HandshakeNumber, ...>` constants with a
   server/mock-served ordered list of handshake descriptors (type, stop, step recipe). The step
   *recipes* (which capture components in which order) stay static per handshake type — only the
   *sequence* of handshakes becomes data.
2. **Keep URL-as-state**, keyed by handshake-event id (or `stop/{k}/{type}`) instead of `[h]` 1–5.
3. **H5 loses the PP-count input step** (F1) — "Reconciliation" becomes an await/result screen.
4. **Linehaul screen** shows consolidated units (summed across consignments), seal(s), vehicle
   config + trailers; re-renders with seal after capture (F2).
5. **Idempotency key per queued submission** (F9) — the queue entry `id` already exists; send it.
6. Capture components unchanged — they're already generic per-stop blocks.

---

# Part C — "The waybill tells us what's in the truck and when": the custody ledger

## 8. Design

The question has two halves: **contents** (which consignments/waybills, what units, weight,
value) and **time** (from when to when, under which seal). Answer both with one construct.

### 8.1 Custody events, snapshotted from the waybill at the transition
Each consignment's custody changes exactly twice per trip: **on-load** and **off-load**. At each
transition, take a **fresh waybill snapshot** and bind it to the handshake:

```
ConsignmentCustodyEvent
  id                    UUID PK
  consignment_id        FK → consignments, not null
  trip_id               FK → trips, not null
  trip_stop_id          FK → trip_stops, null until FP-112 lands
  handshake_event_id    FK → handshake_events, not null   (the LOAD or UNLOAD it belongs to)
  direction             'loaded' | 'unloaded'
  unit_count_verified   int, null            (driver visual, unit grain)
  unit_count_system     int, null            (mock manifest service now; PP later)
  waybill_snapshot      JSONB                (full getSingleWaybill envelope at this moment)
  waybill_snapshot_hash str(64)              (SHA-256 of canonical snapshot — folded into
                                              the handshake event_hash → anchored)
  occurred_at           datetime, not null
  created_at / updated_at
```

Why snapshot *again* at load (we already snapshot at trip creation): waybill data can legitimately
change inside PP between booking and loading. Creation-snapshot = what was *committed* (journey
lock); load-snapshot = what was *in custody*; any drift between them is a recorded observation on
the evidence trail, never a silent update. The unload snapshot captures `failtype`/`manifest`
changes on the PP side at handover.

Why an explicit table rather than deriving from handshake events alone: short-loads, refused
deliveries, and partial unloads make derivation messy; and each row doubles as the **"last seen"
custody record** that `parcel-traceability.md` needs for the dispute use case Bruce called a
market gap (24 Jun §6.1: "at which point in the journey did it leave our custody").

### 8.2 Contents-over-time is then an interval query
```python
async def truck_contents_at(
    db: AsyncSession, *, trip_id: uuid.UUID, at: datetime,
) -> list[OnboardConsignment]:
    """Consignments in custody at instant `at`: loaded on or before, not yet unloaded.

    Interval bounds come from custody events (executed reality), never from the
    planned stop sequence — a skipped pickup means the cargo was never on board.
    """
    loaded = (
        select(
            ConsignmentCustodyEvent.consignment_id,
            func.max(ConsignmentCustodyEvent.occurred_at).label("loaded_at"),
        )
        .where(
            ConsignmentCustodyEvent.trip_id == trip_id,
            ConsignmentCustodyEvent.direction == CustodyDirection.LOADED,
            ConsignmentCustodyEvent.occurred_at <= at,
        )
        .group_by(ConsignmentCustodyEvent.consignment_id)
        .subquery()
    )
    # ... anti-join consignments with an 'unloaded' event ≤ at; join Consignment
    # for waybill ref, unit counts, declared value; join the seal segment whose
    # [applied_at, broken_at) interval contains `at`.
```
- **"What's in the truck right now"** = `truck_contents_at(trip_id, now())` — the dispatcher
  timeline's per-client onboard view, and the multi-stop `onboard()` set from §3.
- **"What was in the truck when the seal broke at 02:14"** = the forensic query for hijack/dispute
  investigations, answerable months later, per consignment, with the anchored waybill snapshot as
  the contents claim: *"between seal SL-7741 (applied 09:47, Linbro Park) and seal break (16:41,
  FedEx DBN), the truck held waybills X and Y: 14 units, 3,240 kg, R840,000 declared."*
- **Per-client evidence cut**: filter custody events by the consignment's client — Courier Guy's
  PDF never mentions FedEx's cargo (needs F3 fixed and exception scoping from §4.2).

### 8.3 Sequencing (works mock-first)
- **Now (iter-2):** the mock manifest service supplies `unit_count_system` and the
  `waybill_snapshot` (shaped as a real `getSingleWaybill` envelope). H2/H5 write custody events;
  driver supplies only `unit_count_verified`. This alone fixes F1 and F6.
- **Later (post-negotiation):** the PP client replaces the mock for snapshots + counts; if the
  operational API arrives, scan events enrich `unit_count_system` provenance. **No schema change
  at cutover** — that's the point of designing the ledger around the waybill envelope now.
- **Hash chain:** `waybill_snapshot_hash` folds into the handshake `event_hash` (F4's canonical
  payload), which anchors to Hedera → the *contents claim itself* becomes tamper-evident, not just
  the counts.

---

# Part D — Consolidated improvement list (priority order)

| # | Change | Fixes / enables | When | Owner hint |
|---|---|---|---|---|
| 1 | Server-side reconciliation; remove driver-typed PP count from H5 | F1 | iter-2 (small) | Tim (UI) + backend |
| 2 | `unit_count_expected` on Consignment; linehaul = units + seals + vehicle config | F2, 24 Jun rule | iter-2, bundle with FP-112 migration | Ciaran |
| 3 | Multi-consignment manifest/linehaul services (kill `scalar_one_or_none`) | F3, multi-client | iter-2 | backend |
| 4 | Canonical event-hash payload incl. artifact SHA-256s, GPS, timestamps, snapshot hash | F4 — do **before** Hedera anchoring is wired | iter-2 | backend |
| 5 | Persist H3 seal verification (or drop the field) | F5 | iter-2 (tiny) | backend |
| 6 | Populate `parcel_manifest_snapshot` + system origin count at H2 (mock) | F6, feeds §8 | iter-2 | backend |
| 7 | Dispatcher override/resume endpoint for `EXCEPTION_HOLD` | F7, v7 §5 requirement | iter-2 | backend |
| 8 | Idempotent handshake completion (idempotency key from offline queue) | F9 | iter-2 | Tim + backend |
| 9 | FP-112 as planned + exception scoping FKs (`consignment_id`, `trip_stop_id`) | multi-stop, per-client evidence | iter-2 | Ciaran |
| 10 | FP-113 journey lock: stops + assignments + **PP snapshots** | tamper-evident cargo plan | after FP-112 | Ciaran |
| 11 | `integrations/parcel_perfect.py` mock-first with real wire shape (§5) | negotiation credibility, cheap cutover | iter-2 | any |
| 12 | Custody ledger (`ConsignmentCustodyEvent`) + `truck_contents_at` | §8, parcel-traceability "last seen" | iter-2/3 boundary | Ciaran |
| 13 | Per-stop handshake refactor: coarse TripStatus, plan-driven sequencing, seal segments, per-stop uniqueness | F8, §7 | iter-3 ticket now, build later | team |
| 14 | Driver app plan-driven step engine (keep URL-as-state + capture components) | §7.3 | iter-3 | Tim |
| 15 | PP credential registry in `core/config.py` (N accounts) | multi-instance/multi-client | when PP client lands | shared-file, coordinate |
| 16 | Update v7: BQ2 signature resolution (F10); unit-vs-parcel vocabulary sweep (F11) | doc truth | now (docs) | Ciaran |
| 17 | Return-leg FK, `Parcel.delivery_stop` → FK, TripTemplate multi-stop, SLA per-stop slots, FP-116 N-stop sim | forward-compat tail | as touched | team |

## Negotiation one-pager (extract for Bruce — §4.4)
Read-only access to: manifest contents by manifest number; scan event history per waybill with
timestamps + facility; destination scan-in status per waybill; slot/booking windows; else
scheduled collection/delivery report exports or webhooks. Framing: FreightProof never writes,
never competes, and makes PP's data legally load-bearing for PP's own customers.

---

*Review complete. Questions/corrections → Ciaran. Driver-app items are coordination input for
Tim's branch, mirroring the 2026-06-24 linehaul note's protocol.*
