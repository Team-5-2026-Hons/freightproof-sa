# Parcel Perfect Integration — Field Mapping & Scan-Status Spec

**Status:** Draft for team review · **Author:** Ciaran · **Date:** 2026-08-04
**Scope:** `backend/app/integrations/parcel_perfect.py` and its immediate consumers.
**Not in scope:** trip orchestration, phase model, Hedera anchoring.

---

## 0. Why this document exists

Two questions:

1. How much work is it to point FreightProof at a live Parcel Perfect account, and what
   do we lose by only parsing a fraction of what PP returns?
2. Can we poll PP at loading / unloading to learn what was actually put on and taken off
   the truck?

Question 2 has a firm answer and it is **no**. Section B explains what that forces, and it
changes what Section A should prioritise. Read B before committing to A.

---

## 1. Evidence base

Everything below was verified against primary sources on 2026-08-04, not inferred:

| Claim | How verified |
|---|---|
| ecomService v28 exposes 13 operations | `GET /ecomService/v28/Soap/index.php?wsdl`, operation list |
| **v32 is the newest version and exposes the identical 13 operations** | `GET /ecomService/v32/Soap/index.php?wsdl`, diffed against v28 |
| v33+ do not exist | HTTP 404 on `/ecomService/v33..v40/downloads/` |
| No tracking/event/scan/manifest-contents method in any version | Union of both WSDLs; also the 12 sheets in `Parcel Perfect Ecommerce Service - v28.xlsx` |
| Integration Service (a *separate* product) handles events — **inbound only** | PP Integration Service v7 overview: "a web service interface for **submitting** waybill, POD and event data **to** Parcel Perfect" |
| **HTTPS works** on the demo host | Official Postman collection ships `https://adpdemo.pperfect.com/ecomService/v28/Json/` |

The complete v32 operation list, for the record:

```
Auth_getSalt              Auth_getSecureToken       Auth_expireToken
Waybill_getSingleWaybill
Quote_requestQuote        Quote_updateService       Quote_quoteToWaybill
Quote_getPlacesByName     Quote_getPlacesByPostcode Quote_getDefItems
Collection_submitCollection  Collection_quoteToCollection  Collection_submitCompoundCollection
```

**One read method exists in the entire API: `getSingleWaybill`.** Everything FreightProof
will ever learn from Parcel Perfect comes through that single call.

---

# PART A — Field mapping

## A1. Current state

`ParcelPerfectClient` is complete and correct for what it attempts: three-step MD5 salt
auth, module-level token cache, one-shot re-auth retry gated on auth-shaped errors only.
Going live is a config change, not a code change:

```
PP_USE_MOCK=false
PP_API_URL=https://adpdemo.pperfect.com/ecomService/v28/Json/   # note HTTPS
PP_API_KEY=<ecom test account email>
PP_API_PASSWORD=<ecom test account password>
```

`get_pp_client()` switches implementations off that flag; every downstream consumer
(`pp_lookup_service`, `consignment_service`, the Celery poll, the wizard endpoints) is
written against the shared `PPWaybillResponse` dataclass and is agnostic to the source.

The gap is coverage: **`_parse_waybill_response` reads ~22 of ~80 available fields.**

## A2. Defects to fix regardless of path

These are wrong today. The mock fixtures conceal both because they populate friendly
values that a real waybill does not.

**A2.1 — `dest_contact` is ALWAYS empty. The field name does not exist.**
`parcel_perfect.py:689` reads `destpertel`. **Stage 0 confirms PP returns no such key** —
the real fields are `destperphone` (empty on GPC10592609), `destperphone2`, and
`destpercell` (`0729840972`). So `details_raw.get("destpertel", "")` returns `""` on every
waybill ever fetched. This is not a fallback gap; it is a wrong key name that fails
silently. Fix: `destpercell or destperphone or destperphone2`.

**A2.2 — `dest_person` is the account, not the person.**
`parcel_perfect.py:688` maps `destpers` → `dest_person`. On GPC10592609 `destpers` is
`"TEST ACC - Glttim001"`; the named human is `destpercontact` = `"Tim"`. The wizard renders
this as "Dest". Fix: parse both — `dest_company` (`destpers`) and `dest_contact_person`
(`destpercontact`).

Both matter beyond cosmetics: the receiver is documented as a one-time-OTP user
(`CLAUDE.md`). OTP is not yet implemented, but when it is it needs precisely the two fields
we do not currently read — the contact person and their cell number.

## A3. Field coverage

Mapped against the reference waybill GPC10592609.

### Tier 1 — build these (direct FreightProof value)

*Revised after Stage 0. The live payload returns **86 detail keys**, and the shipped v28
spec is both incomplete and wrong in places — see A5.*

| PP field | → | Why it earns its place | Live? |
|---|---|---|---|
| **`orighub`, `desthub`** (+ `origopshub`, `destopshub`) | `orig_hub`, `dest_hub` | **Undocumented, and the most useful thing in the payload.** Returns `JNB` / `DUR` — stable 3-letter hub codes. Precinct matching currently leans on town strings, and live `desttown` is `"DURBAN  DEPOT"` (double space). Hub codes are the reliable join key for cross-dock legs. | ✅ populated |
| **`origplace`, `destplace`** | `orig_place_id`, `dest_place_id` | PP internal place IDs (`1683` / `3047`). Stable integer identifiers — the correct thing to map precincts against, not free-text town names. | ✅ populated |
| `destpercontact`, `destpercell`, `destperemail` | `dest_contact_person`, `dest_contact_cell`, `dest_contact_email` | Receiver OTP delivery. Fixes A2.1/A2.2. | ✅ `Tim` / `0729840972` |
| `origpercontact`, `origpercell` | `orig_contact_person`, `orig_contact_cell` | Origin-side counterpart. | ✅ `Ron` / `0846892790` |
| `origperadd2..4` + `origperpcode`, `destperadd2..4` + `destperpcode` | full address structs | We store 1 of 5 components. Live: `Newlands East` / `Durban` / `4001` all discarded today. | ✅ populated |
| **`hcode`, `country`, `itemvalue`** on contents | `PPContents.hs_code`, `.country`, `.item_value` | **Undocumented — resolves the open question.** These are the portal's HS Tariff / CTRY / Value columns. `itemvalue` gives per-line declared value (100.00 / 1500.00), which is what a partial-loss claim is actually argued over. | ⚠️ keys present, null on this waybill |
| `specinstruction` | `special_instruction` | Waybill *is* the instruction (2026-07-16 findings). | ⚠️ present, empty here |

**Demoted from Tier 1 — `destlatitude` / `destlongitude`.** I previously called these the
highest-value fields in the API. **Stage 0 shows both return `null`.** The keys exist; this
waybill carries no geocode. Until we confirm they populate for some service type or
address, treat GPS corroboration from PP as unavailable and do **not** build the
`dest_lat`/`dest_lng` migration on this basis. *Open question for PP — added to C1.*

### Tier 2 — build if cheap

| PP field | → | Note |
|---|---|---|
| `dim1`, `dim2`, `dim3` on contents | `PPContents.dim1..3` | Per-line dimensions (35×25×40 on the reference waybill). Supports volumetric dispute. |
| `chargemass`, `volcm`, `volrate` | mass fields | Charge Mass 8.00 vs Act 1.00 — a mass dispute needs the basis, not just the actual. |
| `collect`, `invoice`, `quote` | PP cross-refs | Cheap; useful when reconciling with PP support. |

### Tier 3 — explicitly decline

The rates block (`cartage`, `insurance`, `docs`, `outly`, `handling`, `cursurcharge`,
`totsurcharge`, `subtotal`, `vat`, `customsduties`, `customsvat`) and the nine
`surchargeflag*` fields. **FreightProof is an evidence platform, not a billing one**
(`docs/scope-boundaries.md`). `total` is already captured as `freight_total` and is
sufficient to state what the consignment was worth to move. Decline deliberately and
record the reason; do not let field-completeness become the goal.

### ~~Unknown~~ — RESOLVED by Stage 0

The portal's **HS Tariff / CTRY / Value** columns are real JSON fields, undocumented in the
spec. Live `contents[]` keys are:

```
defitem, item, pieces, description, dim1, dim2, dim3, actmass, country, hcode, itemvalue
```

`country`, `hcode`, `itemvalue` appear nowhere in the v28/v32 workbook. Promoted to Tier 1.

## A5. The shipped spec is incomplete and partly wrong

Stage 0 findings that no amount of reading the documentation would have produced. **Write
the parser against the live payload, not the workbook.**

| Finding | Impact |
|---|---|
| **`destpertel` does not exist** | Current code reads it → always `""` (A2.1) |
| **`volmass` is the real key**; spec's `volcm`/`volrate` are absent | Anything built from the spec silently gets nothing |
| 86 detail keys returned vs ~80 documented | Undocumented: `orighub`, `desthub`, `origopshub`, `destopshub`, `charge`, `duetime`, `flight`, `mawbno`, `notifydestpers`, `notifyorigpers`, `costcentre`, `costcntr`, `costname` |
| **Dates are `04/08/2026`** (slashes) | Our fixtures use `01.07.2026` (dots) — mock drift. Harmless today (stored as opaque strings) but wrong, and a hazard the moment anyone parses a date |
| **Money/mass arrive as strings** (`'114.00'`, `'8.00'`, `'7.75'`) while `pieces`/`actkg` are ints | Mixed typing. Current `float(...)` coercion survives it; new fields must not assume numeric JSON |
| `reference` is `''`; `manifest` is `null` | `client_reference` empty on live data; manifest not yet assigned (see B2) |
| `tracks[].item` is `null` | Spec says it links to a contents line. It does not. **Parcels cannot be attributed to a contents line** — relevant to partial-loss claims |

## A4. Storage note

`Consignment.pp_raw_json` (JSONB) stores `serialise_waybill()` output — the *serialised
dataclass*, not PP's raw response body. Fields absent from the dataclass are absent from
the archive: we are not silently retaining them. Widening the dataclass is therefore what
widens both the live read and the historical record.

**Recommendation:** additionally persist PP's untouched response body verbatim. An
evidence platform should keep the source document, not only our parse of it. This is a
one-column migration and it makes every future field addition retroactive.

Only `dest_lat`/`dest_lng` merit promotion to real columns — a GPS check should not be
digging through JSONB. Everything else can live in `pp_raw_json`.

---

# PART B — Load / unload scan status

## B1. The direct answer

**Parcel Perfect's ecomService cannot tell us what was loaded onto or taken off a truck.
Not in v28, not in v32, not in any version. There is no polling design that fixes this.**

The PP desktop portal's **Events**, **POD**, **Images** and **Uploaded Files** tabs — visible
on the reference waybill — are *the desktop application*. None of that data is exposed
through ecomService. The scan events exist in PP's database; the ecommerce API simply does
not surface them.

The one API that does handle event data, the **Integration Service**, runs the wrong
direction: it is for couriers and agents to *submit* waybills, PODs, tracking events and
images *into* PP. It reads nothing back.

## B2. What PP can actually tell us

Everything obtainable, via repeated `getSingleWaybill`:

| Signal | Grain | Timing | Verdict |
|---|---|---|---|
| `manifest` (last manifest number) | waybill | changes when PP manifests the waybill onto a truck | **The only load-adjacent signal that exists** |
| `poddate` | waybill | delivery confirmed | End state only — too late for unload reconciliation |
| `failtype` | waybill | delivery failed | End state only |
| `tracks[]` barcodes | **parcel** | at creation | The *expected* parcel set — already persisted as `Parcel` rows |

`manifest` deserves attention: it transitions from absent/0 to a number when PP manifests
the waybill. We already snapshot it (`Consignment.pp_manifest_number`) and the Celery poll
already refreshes it every 60s. It is a genuine "PP believes this waybill is on a truck"
signal — **at waybill grain, with no timestamp, and no relationship to our loading phase.**
Worth surfacing as corroboration. Not worth mistaking for a scan.

> ### ⭐ EXPERIMENT B2a — run this next, it is decisive and takes ten minutes
>
> Stage 0 confirmed GPC10592609 currently has **`manifest: null`**. We now hold live
> credentials. So:
>
> 1. Tim manifests GPC10592609 onto a vehicle in the PP portal, noting the wall-clock time.
> 2. Re-run the Stage 0 probe immediately, then again at +1min and +5min.
>
> **What it settles:** whether `manifest` populates on manifesting, and how quickly. If it
> does, FreightProof gains its **only third-party, non-driver-sourced "this freight was
> loaded" signal** — at waybill grain, for free, on infrastructure already polling every
> 60s. That is directly the question in §B4 about not depending on the driver.
>
> Also record whether `poddate` populates on marking delivery in the portal, and whether
> anything else in the 86 keys moves. This is the cheapest high-value test available to us.
>
> **Harness:** `backend/scripts/pp_watch.py` — polls on a loop, snapshots all 128 comparable
> fields, prints only what changed. Run from `backend/` as `python3 -m scripts.pp_watch`.

### ✅ RESULT — EXPERIMENT B2a (partial), run 2026-08-04 17:48 UTC

**The ecomService API mirrors PP portal state changes in near-real time.**

A `Mode: Customer` account cannot manifest, dispatch or deliver — those are depot
functions, and the portal's context menu offers only Edit / View / Cancel / Collect this
waybill / POD Images Export / Print. So only one lifecycle transition was triggerable.
It was, and it propagated:

```
17:48:20  baseline    details.collect = None
17:48:41  poll 2      no change
17:48:51  poll 3      details.collect: None -> 21928     ← "Collect this waybill"
```

**Propagation landed inside a 10-second window.** Exactly one field moved; notably
`editstate.allowedit` stayed `1`, so booking a collection does *not* lock the waybill.

**What this establishes:** the API is live, not cached or batch-refreshed. The reason we
cannot see `manifest` / `poddate` move is **purely account permissions**, not API staleness.
Before this run those two explanations were indistinguishable, and they have opposite
consequences — one is fixable with an account, the other is not fixable at all.

**What it does NOT establish:** that `manifest` and `poddate` behave identically. One field
was observed. Same table and same read path make it a reasonable inference, not a proven
one. It stays inferred until a depot-level account exists.

**Consequence:** the ask in C1 is now evidence-backed. Requesting an operator/depot test
account from PP or the courier is worth real effort — if granted, `manifest` almost
certainly does populate, which would give FreightProof its only third-party,
non-driver-sourced load signal (subject to the B2b ceiling). Until then: mock.

---

## 🔴 B2c. PP WAYBILLS ARE MUTABLE AFTER CREATION — evidence-integrity risk

**Observed 2026-08-04 17:53 UTC.** A portal *Edit* on GPC10592609 changed **68 fields in
one poll interval**:

```
_counts.tracks:            2  ->  27       ← 25 new parcel barcodes appeared
_counts.contents:          2  ->  3
details.pieces:            2  ->  27
details.actkg:             2  ->  27
details.total:      '114.00'  ->  '307.80'
details.specinstruction:  ''  ->  'Enter through gate 4'
details.reference:        ''  ->  '#1'
details.nondoxflag:        0  ->  1
details.customsvalue:   None  ->  '200.00'
details.currency:       None  ->  'ZAR '    (note trailing space)
```

**The expected parcel set — the thing every reconciliation is measured against — grew from
2 to 27 with no signal that anything happened.** No version, no timestamp, no audit field.

### Why this is serious

`Consignment.pp_raw_json` and `parcel_count_expected` are the reconciliation baseline. The
Celery poll (`tasks/parcel_perfect.py`) refreshes every active consignment **every 60
seconds** and `fetch_and_sync_consignment` **silently overwrites** them:

```python
consignment.pp_raw_json = raw_json                      # clobbered
consignment.parcel_count_expected = parcel_count        # clobbered
consignment.pp_manifest_number = waybill.details.manifest
# Parcel rows: new barcodes inserted, existing never deleted
```

So a waybill edited mid-trip **moves the baseline underneath a trip that is already
anchored**, with no exception raised and no record that the expected set ever differed.
After loading, that is indistinguishable from tampering — and FreightProof would not merely
fail to detect it, it would *adopt* the new figure as truth.

This also sits directly against the journey-lock premise in `CLAUDE.md`: *"Never modify trip
params after creation without an explicit exception event."* PP has no such guarantee, and
we currently import its changes unconditionally.

### What is required (not yet built — new work, needs a ticket)

1. **Diff before write.** `fetch_and_sync_consignment` must compare incoming `tracks[]`,
   `pieces` and `declaredvalue` against the stored baseline before overwriting.
2. **Raise an exception on drift** once the trip has passed `loading` for that consignment's
   pickup stop — `ExceptionType` scoped to `consignment_id` + `trip_stop_id`.
3. **Never silently grow the parcel set post-loading.** Pre-loading edits are legitimate
   dispatcher activity; post-loading edits are evidence events.
4. **Retain the superseded baseline.** The original expected set is evidence in its own
   right and is currently destroyed on overwrite.

This is arguably the most consequential finding in this document. It was invisible until we
had live credentials and a field-diff harness — the mock fixtures are immutable, so no test
could ever have surfaced it.

### Other confirmations from the same run

- `specinstruction` populates and is exactly the gate-relevant content expected
  (`"Enter through gate 4"`) — confirms its Tier 1 placement.
- `details.reference` populates on edit; `wayrefs[0].reference` carried `'#1'` beforehand,
  so **`wayrefs` leads `details.reference`** — parse both.
- `tracks[].item` remained null across 27 parcels. **Parcels cannot be attributed to a
  contents line**, confirming A5. Partial-loss claims cannot be tied to a specific
  commodity through PP data alone.
- Money fields recalculate server-side on edit; never cache a derived total.

### B2b. Ceiling on the manifest signal — read before relying on it

Even if EXPERIMENT B2a succeeds, `manifest` is structurally limited in three ways:

1. **It is a level, not an event log.** "Last manifest number" is last-write-wins. Polling
   at 60s observes *state*, not transitions — a manifest/unmanifest/remanifest between two
   polls is invisible, and there is no timestamp saying when it changed. Our own
   `PhaseEvent.completed_at` is the only trustworthy clock.
2. **It cannot express a cross-dock.** One integer per waybill. On CPT→BFN→JHB a waybill
   that changes trucks at Bloemfontein simply overwrites its manifest number. PP cannot say
   "was on truck A, now on truck B" — but our phase model has `loading` twice and needs
   exactly that. **PP's manifest cannot carry multi-leg load history.**
3. **It is waybill grain, not parcel grain.** It can never evidence *which parcels* were on
   the truck — only that PP believes the waybill was.

So the realistic ceiling: `manifest` is **corroboration for a single-leg loading phase**, and
nothing more. Valuable — it is the only non-driver-sourced load signal available — but it
cannot be the mechanism. The scan ledger (B4b) remains the mechanism.

## B3. Consequence: two dead code paths

This is not hypothetical. `Parcel.pp_scan_out_at` and `Parcel.pp_scan_in_at` exist in the
model and in `0001_initial_schema.py`, are exposed in `schemas/trips.py`, and are **never
written anywhere in the codebase** — verified by grep. No PP endpoint can populate them.

Therefore `origin_scan_complete` in `manifest_service.py` (lines 74, 89, 142) is
`all(p.pp_scan_out_at is not None ...)` over a column that is always `NULL`, and is
**structurally always `false`** — in both the dispatcher manifest and the driver linehaul.

**Decide:** either populate these columns from FreightProof's own capture (B4), or delete
the columns and the `origin_scan_complete` field. Leaving a permanently-false field on an
evidence artefact is the worst of the three options.

## B4. What to do instead — the recommended design

The gap resolves cleanly once framed correctly:

> **Parcel Perfect is the system of record for what was *supposed* to be on the truck.
> FreightProof is the system of record for what *actually* was.**

PP already gives us the expected set at parcel grain — `tracks[]`, one barcode per parcel,
already persisted as `Parcel` rows. What is missing is the observed set. **PP structurally
cannot supply the observed set, so FreightProof must capture it.** That is not a
workaround for a missing API; it is the product's actual purpose. A platform whose value
proposition is independent evidence should not be sourcing its ground truth from the system
it exists to check.

### B4a. There is no second party. Revised 2026-08-04.

An earlier draft of this section leaned on the guard as an independent witness. **That is
withdrawn.** Confirmed by the team: there is no guard interaction, the zero-login guard
page is no longer planned, and pulling gate exits from facility systems is a future want,
not a current capability. Also unavailable: **Pulsit telemetry is explicitly out of scope**
(`phase_service.py:413` — `pulsit_geofence_confirmed` stays null), so there is no
independent vehicle GPS either.

So the honest position: **the driver's phone is the only capture device, and the driver is
the only operator.** No design that requires a second human is buildable right now.

### B4b. The driver does not scan. Corrected 2026-08-04 (second revision).

An earlier draft of this section proposed driver-operated barcode scanning. **That is
withdrawn.** Overruled by the domain expert on operational grounds:

- **Scanning at the truck takes far too long and does not happen in practice.**
- **The driver never sets foot on the warehouse floor** — security policy.
- **The warehouse scans in and out using its own system**, which in some cases *is* Parcel
  Perfect. That feed is what we want; it is not obtainable through any API we can reach.

So the correct division of evidence is by **grain**, not by capture modality:

| Grain | Who observes it | Available? |
|---|---|---|
| **Parcel identity** — which specific parcels | warehouse scan system | ❌ **no API access → mock** |
| **Unit count** — how many parcels/pallets | driver, at the truck | ✅ built |
| **Continuity** — set unchanged in transit | seal chain | ✅ built |
| **Presence** — truck was there, then | Pulsit | ⬅ future |

**The codebase already models this correctly.** `manifest_service.get_linehaul_for_driver`
returns `consolidated_unit_count` with the comment *"the driver counts pallets, never parcels
(Bruce, 24 Jun)"*, and `Consignment.unit_count_expected` is documented as pallet grain that
"PP cannot supply". The model was right; the earlier recommendation was the thing out of step.

The driver's unit count is a genuinely useful independent number **precisely because** he is
outside the warehouse: he has no access to the scan system and cannot reconcile his count
against it.

### B4b-i. Consequence — mock the scan feed behind a real interface

Do not scatter scan fixtures through the seeder. Define the feed as an inbound interface and
mock behind it, mirroring `get_pp_client()`:

```
ScanFeed (Protocol)
├── MockScanFeed     ← demo, driven by the dev trigger panel
└── <WmsScanFeed>    ← future: PP depot API or the courier's WMS
       selected by config, same shape as PP_USE_MOCK
```

This is defensible at examination: the integration point is *specified* rather than
hand-waved, the swap is one config flag, and the same pattern is already working for PP.

It also resolves B3 cleanly. `Parcel.pp_scan_out_at` / `pp_scan_in_at` are **warehouse scan
timestamps** — exactly what the names say. Populate them from the feed (mocked for now) and
`origin_scan_complete` stops being permanently false.

### B4c. Fix first: blind capture

The driver app currently **shows the loading count to the driver before asking for the
destination count** (`H5VisualCount.tsx`, `h2Count` prop → "Loaded at origin (H2): N
parcels"). A colluding driver reads it and types it back, and the reconciliation compares a
number with itself.

Removing that display is hours of work and is the single highest evidential gain available.
It also aligns with the theft-risk rule (drivers never see per-parcel data or counts) that
`manifest_service.py` already enforces on the linehaul.

### B4d. Where this lives in the phase model

Loading and unloading are `PhaseType.LOADING` / `PhaseType.UNLOADING`, and they **recur per
stop** — a three-stop cross-dock has `loading` twice. Per-stop scoping already exists
(`PhaseEvent.trip_stop_id`), as does the storage:

| Field on `PhaseEvent` | Use |
|---|---|
| `parcel_manifest_snapshot` (JSONB) | **the observed barcode set for this stop's loading/unloading** |
| `parcel_count_origin`, `parcel_count_destination` | derived cardinality |
| `driver_visual_count` | the blind human count, kept separate from the scan |
| `seal_number`, `seal_photo_artifact_id` | seal chain (camera OCR later — deferred, not required) |

The *expected* set per stop is already computable: `Consignment.pickup_stop_id` /
`delivery_stop_id` (FP-112) partition `tracks[]` by stop. So expected-vs-observed
reconciliation is a query against data that already exists — the missing half is purely the
observed set.

**Consequence for `pp_scan_out_at` / `pp_scan_in_at` (B3):** these become writable from *our*
capture rather than PP's. That resolves the dead-column decision — they stop being a PP
mirror and become FreightProof's own scan ledger. Rename accordingly if kept.

## B5. Options rejected, with reasons

| Option | Verdict |
|---|---|
| Poll harder / poll a different ecomService method | **Impossible.** `getSingleWaybill` is the only read method in the API. |
| Scrape the PP portal's Events tab | **No.** Brittle, unauthorised, indefensible at examination, and likely a T&C breach. |
| Push our events into PP via Integration Service | **Out of scope** — that is operating, not recording (`scope-boundaries.md`). Worth noting as a commercial angle for the write-up; not for this build. |
| Ask PP to expose event reads | **Yes — do this in parallel.** Costs one email, and a "no" is itself a documentable finding. See C1. |

---

# PART C — Staged plan

Each stage ends with something verifiable. **Stage 0 gates everything else** — several
Tier-1 decisions above are unconfirmed until a real payload exists.

### Stage 0 — ✅ **COMPLETE — PASSED** *(run 2026-08-04)*

**The portal account and the ecom account share a database.** `getSingleWaybill`
("GPC10592609") over HTTPS returned the full waybill. The project's single largest
integration risk is cleared: live PP is reachable and returns our own portal-created
waybills.

- [x] Auth verified — a pre-issued `PP_API_TOKEN` is **already configured** in
      `backend/.env`, alongside `PP_API_URL=https://adpdemo.pperfect.com/ecomService/v28/Json/`.
      `PP_USE_MOCK=true` is the only thing standing between us and live data.
- [x] Raw payload captured; Tier 1 corrected (geo demoted, hubs/place-IDs/`itemvalue` promoted)
- [x] Undocumented fields catalogued → A5

**⚠️ Do not commit the raw payload.** It carries names, physical addresses and cell numbers,
and this is a **public GitHub repo**. POPIA applies to personal data regardless of it being
test data. Commit a **redacted** fixture (contacts/cells/addresses replaced, structure and
key set preserved) — the field shapes are what fixtures need, not the values. The raw file
is currently held outside the repo in the session scratchpad.

### Stage 1 — Fix the mapping defects *(~1 hour)*

- [ ] A2.1 `destpercell` fallback · A2.2 `destpercontact` as named person
- [ ] Unit tests driven from the Stage 0 payload
- **Verify:** `pytest` green; a test asserts contact resolution against the real payload.

### Stage 2 — Widen the parser to Tier 1 *(~half day)*

- [ ] Extend `PPWaybillDetails`, `_parse_waybill_response`, `serialise_waybill`
- [ ] Extend `_mock_waybill` / `_routed_waybill` in step (`test_seed_fixtures.py` enforces this)
- [ ] Migration: `dest_lat`/`dest_lng` on `Consignment`; raw-response column (A4)
- [ ] Decide and record the Tier 3 decline
- **Verify:** identical dataclass shape from mock and live for the same waybill.

### Stage 3 — Regenerate fixtures from reality *(~half day)*

- [ ] Create ~8 test waybills in the PP portal covering: multi-line contents, delivered
      (POD), failed delivery, unmapped account, multi-leg routes
- [ ] Generate fixtures from captured payloads rather than hand-authoring them
- [ ] Seed an `Organization` with `pp_account_number='MYU001'` so live lookups attribute
      a client org instead of warning
- **Verify:** demo runs end-to-end on mock; fixture field shapes match live byte-for-byte.

### Stage 4 — `ScanFeed` interface + dev trigger panel *(next task — unblocked)*

No longer blocked: B4b resolved who observes what. Operator/depot PP access will **not** land
before the presentation, so the warehouse feed is mocked and driven from a dev panel.

- [ ] `ScanFeed` protocol + `MockScanFeed`, factory mirroring `get_pp_client()`
- [ ] Feed populates `pp_scan_out_at`/`pp_scan_in_at`; fixes `origin_scan_complete` (B3)
- [ ] Dev trigger panel, registered only when `ENVIRONMENT != "production"` — scan out/in,
      **partial scan** (the discrepancy path), unexpected barcode, PP lifecycle, exceptions
- [ ] Reconciliation: expected (`tracks[]`, per stop via `pickup_stop_id`/`delivery_stop_id`)
      vs observed → discrepancy raises a `TripException` scoped to consignment + stop
- **Principle:** every trigger drives the mock and flows through *real* orchestration. A
  trigger that writes to the DB directly demonstrates only the trigger.
- **Handoff prompt written 2026-08-04** — carries the verified PP findings, the operational
  constraints, the do-not-build list, and four questions to answer before implementing.

### Stage 5 — PP drift detection *(new — from B2c, needs its own ticket)*

- [ ] Diff incoming `tracks[]`/`pieces`/`declaredvalue` against the stored baseline before
      overwrite in `fetch_and_sync_consignment`
- [ ] Raise an exception on drift once the consignment's pickup stop has passed `loading`
- [ ] Retain the superseded baseline — it is evidence

---

## C1. Questions for Parcel Perfect

> **Update, 1 September 2026 — the access route changed; the constraint did not.** Parcel Perfect
> declined a sandbox because we are not attached to a client, so Bruce is routing around them via
> **X International** (Cape Town, a Parcel Perfect user), who have offered visibility into live
> events in *their* environment. **§B1 above still applies: no ecomService version exposes scan or
> tracking events, for any account, at any permission level.** Client-level goodwill does not create
> an API that is not there — so the ask has to be re-scoped before Bruce meets them, or he will ask
> for something that cannot be granted:
>
> - **Not** "Parcel Perfect API access to scan events" — structurally unavailable (§B1).
> - **Yes** to either **(a)** their **own warehouse scan feed** — whatever system produces the
>   scan-in/scan-out events *before* they reach PP — which drops straight into the existing
>   `ScanFeed` protocol (`backend/app/integrations/scan_feed.py`) as a `WmsScanFeed` beside
>   `MockScanFeed`, exactly as §B4b-i designed for; or **(b)** **read-only portal access** on a real
>   account, so the Events / POD / Images tabs can be *observed* and the mock shaped against real
>   data. Observation, not integration.
> - Worth asking while we have a live account, because it *is* in the API: does the `manifest` field
>   move in real time as waybills are manifested onto a vehicle (question 3 below)? That is the one
>   load-adjacent signal ecomService actually exposes, and only a live account can answer it.
>
> Tracked as decision 13 in [iteration3_plan.md](iteration3_plan.md) §8.

Send with the ecom test account request:

1. Is there **any** API — ecomService or otherwise — to **read** waybill tracking/scan
   events? The portal shows an Events tab; nothing in v28–v32 exposes it.
1b. Under what conditions do `destlatitude`/`destlongitude` populate? They returned `null`
   on GPC10592609. Is geocoding service-dependent, account-dependent, or off on demo?
1c. Are `orighub`/`desthub`/`origplace`/`destplace` stable and safe to key on? They are
   undocumented but look like the right join keys for our depot model.
2. Is there any endpoint returning **the waybills on a given manifest number**? We
   currently have this mock-only (`supports_manifest_lookup=False`, "ask #1, July visit")
   and it is the single most useful missing capability for trip creation.
3. Does the `manifest` field update in real time as waybills are manifested onto a vehicle?
4. Is the ecom test account backed by the same database as our portal test account?
5. Is HTTPS supported on production ecomService endpoints, not just the demo host?

## C2. Decisions required from the team

| # | Decision | Owner |
|---|---|---|
| 1 | Driver scans barcodes at loading/unloading — accept, given no second party exists? (B4a–B4d) | Bruce |
| 1b | Remove the expected count from the driver's view before the destination count? (B4c) *Recommend: yes, immediately.* | Team |
| 2 | Populate or delete `pp_scan_out_at`/`pp_scan_in_at` and `origin_scan_complete`? (B3) | Team |
| 3 | Confirm the Tier 3 rates decline | Team |
| 4 | Store PP's raw response verbatim alongside our parse? (A4) | Team |
| 5 | Demo on mock or live? *(Recommendation: **mock**. `adpdemo.pperfect.com` being down mid-presentation is an unacceptable failure mode, and mock retains the manifest bulk-fetch flow, which live does not support. "Runs on mock by default; here is the same code against live PP" is a stronger examination answer than either alone.)* | Team |

---

## Sources

- [Parcel Perfect™ — Track & Trace Courier Management Software](https://www.parcelperfect.com/)
- [Parcel Perfect Integration Service v7 overview](https://www.scribd.com/document/456530300/Parcel-Perfect-Integration-Service-v7)
- ecomService v28 / v32 WSDLs — `https://adpdemo.pperfect.com/ecomService/v{28,32}/Soap/index.php?wsdl`
- ecomService v28 downloads incl. official Postman collection — `https://adpdemo.pperfect.com/ecomService/v28/downloads/`
- Local: `docs/parcel_perfect_documentation/` (v28 spec + 12-sheet workbook)
