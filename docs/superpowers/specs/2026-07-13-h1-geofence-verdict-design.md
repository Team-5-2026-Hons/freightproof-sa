# H1 Origin Gate-In — Geofence Verdict + Hedera Anchor (Design Spec)

**Date:** 2026-07-13
**Branch:** Ciaran
**Status:** Design — awaiting review before implementation plan

## Problem

The Origin Gate-In handshake (driver-app "H1", backend `HandshakeType.ORIGIN_GATE_IN`)
currently **records** an arrival but does not **verify** it. `advance_h1` stores only
`driver_phone_lat/lng` and `gate_photo_artifact_id`, then marks the handshake complete.
Nothing compares the captured coordinate to where the origin gate actually is, so a
dispatcher cannot confirm the truck and driver were where they claimed. H1 also computes
no `event_hash` and is not anchored to Hedera, so the arrival sits entirely outside the
tamper-evident evidence chain.

This feature turns the recorded arrival into a **verified, anchored** one:

1. Compute a geofence verdict (distance to the origin gate + inside/outside the precinct
   radius) **server-side**, store it, and surface it to the dispatcher.
2. Give H1 its **own** Hedera anchor, with the verdict inside the anchored payload.

## Goals

- Server-side geofence verdict computed at `advance_h1` and persisted on the handshake row.
- Dispatcher trip-detail timeline shows the verdict, the raw coordinates, the precinct
  street address, a map link, and an honest "Pulsit not yet cross-checked" line.
- H1 gets its own `BlockchainReceipt` via the existing `anchor_subject`, **fail-open**:
  the handshake completes even if Hedera is unreachable, and the miss is visible, not silent.

## Non-goals (explicitly out of scope — see "Radar" below)

- No driver-app changes. The gate photo stays in H1 for now.
- No `GPS_MISMATCH` exception and no trip hold for an out-of-geofence arrival — **display only**.
- No precinct-management UI, no per-gate modelling, no Pulsit horse-GPS cross-reference.
- No anchoring of H2/H5 (still deferred); this story only anchors H1.

## Key decisions (settled during brainstorming)

| Decision | Choice | Reason |
|---|---|---|
| Compute location | **Server-side, stored** | Business logic belongs in `orchestration/` not a React component; only a stored verdict can enter an anchored payload; temporally correct (frozen against precinct config as-of arrival). |
| Out-of-geofence behaviour | **Display only** | "Evidence, not operations." Dispatcher judges; the system records, it does not respond. |
| Hedera anchor for H1 | **Its own receipt, not a Merkle batch** | H1 is a single, meaningful custody-boundary event. Batching (`CHECKPOINT_BATCH`) is for high-frequency route pings; a batch would only add indirection and weaken "this arrival = this receipt." |
| Anchor failure mode | **Fail-open** | The platform records operational truth regardless; the chain is the *added* evidence layer, so a chain outage must not block a driver's gate-in. Failure is surfaced (pending receipt + structured log), not swallowed. |
| Precinct address | **Surface existing field** | `Precinct.address` already exists in model, schema, and shared type — seed + display only. |

## What already exists (no work needed)

- `Precinct` has `latitude`, `longitude` (both `NOT NULL`) and `geofence_radius_metres`
  (default 200). Seeded with real coords for the two demo depots.
- `Precinct.address` exists in the model, in `PrecinctRead`, and in the shared frontend
  `Precinct` type. It is simply not seeded or displayed yet.
- `HandshakeEvent` already has `event_hash` and `blockchain_receipt_id` columns for **all**
  handshakes — the feeder/anchor split is a docs convention, not a schema constraint.
- `anchor_subject()` (`blockchain/anchor_service.py`) is a proven, reusable path:
  hash → submit to HCS in a timeout-bounded thread → persist a `BlockchainReceipt`. It is
  already called synchronously by trip creation for the H0 journey lock. **Anchoring H1
  means calling an existing function, not building a subsystem.**
- Dispatcher `ChainReceiptTag` already renders a receipt as "Pending anchor" when
  `hedera_topic_id` is null — the fail-open pending state has a visual representation already.

## Design

### Component 1 — Geofence math (`backend/app/core/geo.py`, new)

A pure, stateless module. One function:

```
haversine_metres(lat1, lng1, lat2, lng2) -> Decimal
```

Earth radius as a named module constant (`EARTH_RADIUS_METRES = 6_371_000`) — no magic
number. No DB, no I/O. Trivially unit-testable. The verdict *decision* (compare distance to
the precinct radius) stays in `advance_h1`, which already holds the precinct and the event —
`geo.py` only measures distance.

### Component 2 — Handshake model (`db/models/handshakes.py`)

Two new nullable columns on `HandshakeEvent`, named to parallel the existing
`pulsit_geofence_confirmed`:

- `driver_phone_distance_metres: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)`
- `driver_phone_geofence_ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)`

Both nullable. `null` means "not computed" — e.g. the trip has no `origin_precinct_id`, or
a non-gate handshake. Not expected in practice (trip creation always derives the origin
precinct from the stop route) but handled defensively.

### Component 3 — Migration

One Alembic migration adding the two columns:
`backend/migrations/versions/2026_07_13_ciaran_add_h1_geofence_verdict.py`.

Generated only after `git fetch origin` and checking `dev` for unmerged migrations
(4-dev coordination). The new `BlockchainReceiptType` value needs **no** migration —
`receipt_type` is a `String` column.

### Component 4 — Read schema (`schemas/handshakes.py`)

`HandshakeEventRead` gains `driver_phone_distance_metres` and `driver_phone_geofence_ok`.
**`H1CompleteRequest` is unchanged** — the driver still submits `driver_phone_lat/lng` +
`gate_photo_artifact_id`; the verdict is derived server-side, so the driver app needs no change.

### Component 5 — Receipt type (`db/models/enums.py`)

Add `ORIGIN_GATE_IN = "origin_gate_in"` to `BlockchainReceiptType`.

### Component 6 — Fail-open anchor wrapper (`blockchain/anchor_service.py`)

`anchor_subject` (used by trip creation) is **fail-closed** and must stay that way — do not
change it. Add a sibling that keeps receipt persistence in the blockchain layer:

```
anchor_subject_fail_open(db, *, subject_type, subject_id, canonical_payload,
                         receipt_type, trip_id=None) -> tuple[BlockchainReceipt, bool]
```

- On success: delegates to `anchor_subject`, returns `(receipt, True)`.
- On `HederaServiceError` / `HederaTimeoutError`: persists a **pending** `BlockchainReceipt`
  (`data_hash` set from `compute_payload_hash`, all `hedera_*` fields null), logs a
  structured `logger.error` with subject context, and returns `(receipt, False)`. Does **not**
  re-raise, so the caller's transaction survives.

This is reusable — H2/H5 can adopt it when their anchoring lands.

### Component 7 — Orchestration (`orchestration/handshake_service.py::advance_h1`)

New behaviour, in order:

1. Load the trip's origin `Precinct`.
2. If present, `distance = haversine_metres(driver_phone, precinct)`;
   `ok = distance <= precinct.geofence_radius_metres`. Store both on the event.
   If absent, leave both null (defensive).
3. Build the canonical H1 payload and compute `event.event_hash` (closes the today-gap
   where H1 computes no hash). Payload: `trip_id`, `handshake_type`, `driver_phone_lat`,
   `driver_phone_lng`, `driver_phone_distance_metres`, `driver_phone_geofence_ok`,
   `completed_at`. **No PII leaves the system** — only the SHA-256 hash goes to Hedera;
   the payload itself is stored in `BlockchainReceipt.payload_json` in Postgres (POPIA).
4. Call `anchor_subject_fail_open(...)` with `receipt_type=ORIGIN_GATE_IN`. Set
   `event.blockchain_receipt_id = receipt.id`. On Hedera failure the receipt is pending;
   the handshake still completes.
5. `event.status = COMPLETED`, `trip.status = ORIGIN_GATE_IN` — **regardless** of the
   geofence verdict or the anchor outcome. Never raises, never holds.

### Component 8 — Dispatcher (`dispatcher/app/(app)/trips/[id]/page.tsx`)

The H1 timeline node's expandable detail renders:

- **Coordinates** — `driver_phone_lat, driver_phone_lng`.
- **Geofence verdict badge** — `✓ 84 m · within 200 m` (success) or
  `✗ 1.9 km · outside 200 m` (warning). Sourced from the stored fields; shown only when
  non-null.
- **Precinct street address** — `originPrecinct.address` (from `usePrecincts`), for human
  "which depot/gate" context.
- **Map link** — opens the coordinates in a maps provider (plain URL, no geocode key needed).
- **Honest cross-source line** — "Horse GPS — Pulsit pending (not yet cross-checked)".
- **Receipt tag** — existing `ChainReceiptTag`, which already shows "Pending anchor" vs an
  anchored HashScan link, so the fail-open state is represented with no new UI.

Add `origin_gate_in → "Gate-in receipt anchored"` to the dispatcher's `RECEIPT_LABELS`.

### Component 9 — Seed (`backend/scripts/seed_demo.py`)

Populate `address` for the two demo precincts (Epping, Linbro). One-line-per-row change.

## Data flow

```
Driver app (unchanged)                Backend advance_h1                         Dispatcher
─────────────────────                 ──────────────────                         ──────────
capture phone GPS  ──POST H1──▶  load origin Precinct
+ gate photo                     haversine_metres(phone, precinct)
                                 distance + ok  ─▶ store on HandshakeEvent
                                 build canonical payload + event_hash
                                 anchor_subject_fail_open(ORIGIN_GATE_IN)
                                   ├─ ok:   BlockchainReceipt (anchored)
                                   └─ fail: BlockchainReceipt (pending) + log.error
                                 status=COMPLETED, trip=ORIGIN_GATE_IN
                                                                         GET trip detail ─▶ render
                                                                         verdict badge, coords,
                                                                         address, map link,
                                                                         "Pulsit pending",
                                                                         receipt (anchored|pending)
```

## Error handling

- **Out of geofence:** stored as `driver_phone_geofence_ok = False`; handshake completes
  normally. No exception, no hold. Dispatcher renders the ✗ badge.
- **No origin precinct (unexpected):** verdict fields left null; handshake completes; badge
  hidden.
- **Hedera unreachable / times out:** caught in `anchor_subject_fail_open`; a **pending**
  receipt is persisted and a structured `logger.error` is emitted; handshake completes;
  dispatcher shows "Pending anchor". Reconciliation via a future Celery retry (FP-005).
- **event_hash** is computed and stored locally even on anchor failure, so a later retry can
  re-anchor the identical payload.

## Testing

- **Unit — `tests/unit/test_geo.py`:** `haversine_metres` against known distances
  (Epping→Linbro ≈ 1 260 km; a sub-200 m pair), symmetry, and zero distance.
- **Integration — `tests/integration/test_h1_geofence.py`:**
  - H1 inside the geofence → `driver_phone_geofence_ok is True`, distance stored,
    trip status `ORIGIN_GATE_IN`, an anchored receipt linked.
  - H1 outside the geofence → `driver_phone_geofence_ok is False`, **no `TripException`
    created**, handshake still `COMPLETED` (proves display-only).
  - Hedera failure (injected `HederaService` that raises) → handshake completes, a
    **pending** receipt exists (`hedera_topic_id is None`), `event_hash` stored
    (proves fail-open).

## Radar — deliberately deferred, recorded so we don't lose them

1. **Remove the H1 gate photo.** From inside the cab there is nothing meaningful to
   photograph and it is friction on a driver mid-manoeuvre. Ultimately replace it with a
   Pulsit in-cab camera pull by timestamp (a passive record, not a driver task). Requires a
   driver-app change, so it waits until Tim's app is merged.
2. **Fix overstated driver-app copy.** `H1Verification.tsx` ("this anchors H1 to the
   blockchain") and `H1EntryPhoto.tsx` ("anchored as evidence") overstate what H1 did — fix
   alongside the photo removal.
3. **Precinct-management page (dispatcher).** CRUD for precincts with **geo-mapping / map
   view** to see and place precincts and tune geofence radius. Critically, model **multiple
   named gates per precinct** — a single centre+radius proves "inside the depot" but not
   "which gate." `PrecinctCreate`/`PrecinctUpdate` schemas already exist; only `GET` is
   wired.
4. **Pulsit may supply precinct data.** Unconfirmed — we do not have their API yet. Revisit
   after the July Parcel Perfect / Pulsit visit.
5. **Anchor H2/H5** (still deferred). This story establishes the exact `anchor_subject_*`
   pattern they will copy. Until then the dispatcher's "N of M receipts anchored" will show
   gaps (H0 ✓, H1 ✓, H2 ✗, H5 ✗) — honest, not a bug.

## Flags for the team

- **Shared-ish files touched:** `db/models/handshakes.py`, `schemas/handshakes.py`,
  `db/models/enums.py`, `blockchain/anchor_service.py`, one Alembic migration. None are the
  heavily-shared registration files (`main.py`, `config.py`, `models/__init__.py`), but the
  migration needs the usual 4-dev coordination (`git fetch`, check `dev`, name-tag the file).
- **Evidence-model change:** bringing H1 into the anchored set changes the documented
  feeder/anchor scheme (`api_contract_dispatcher_driver.md §3.4`, technical full-picture
  doc). This is a deliberate, team-agreed change — needs a heads-up to the other devs and a
  doc update, not silent divergence.
- **New `.env` keys:** none. (Hedera config already exists; the geocode key remains
  un-provisioned and is not required — the dispatcher uses a plain map link.)
