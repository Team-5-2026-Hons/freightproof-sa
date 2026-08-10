# FreightProof phase model

**Status:** current implementation reference
**Last verified:** 2026-08-10 against the plan generator, phase service, schemas, shared TypeScript metadata, and driver routes.

FreightProof represents a trip as a committed, ordered plan of phase-event rows. The plan is generated when the trip is created and is then walked in sequence. Its length and repeated phase types are data; they are not encoded as a fixed set of numbered endpoints.

## Why the model is plan-driven

A two-stop trip needs one loading and one unloading operation. A cross-dock trip can unload cargo, collect different cargo, reseal, and depart again at an intermediate stop. A lifecycle that allows only one row of each type cannot represent that custody chain.

The current model separates three concerns:

- `Trip.status` is a coarse lifecycle value such as `created`, `active`, `closed`, or `cancelled`.
- `PhaseEvent` is the immutable plan row and evidence ledger for one point in the journey.
- `Trip.current_phase` and `Trip.current_stop` are caches derived from the phase-event ledger.

The phase-event ledger is authoritative. Code must not use `Trip.status` as a fine-grained sequencer or assume that a phase type occurs only once.

## Plan generation

The generator is implemented in [`backend/app/orchestration/phase_plan.py`](../backend/app/orchestration/phase_plan.py).

It emits:

1. `trip_creation` once, without a stop.
2. At the first stop, `activation`.
3. At any stop receiving cargo, `unloading`.
4. At any stop collecting cargo, `loading`.
5. At every non-final stop, `departure` followed by `in_transit`.
6. At the final stop, `confirmation` after the required unloading row.

A common two-stop loaded trip is therefore:

```text
trip_creation
  → activation(origin)
  → loading(origin)
  → departure(origin)
  → in_transit(origin-to-destination leg)
  → unloading(destination)
  → confirmation(destination)
```

The `in_transit` row is associated with the stop the vehicle departed from, but the driver completes it on arrival at the next stop. This records actual arrival time and location before unloading evidence is captured.

A three-stop cross-dock plan can contain repeated unloading, loading, departure, and transit rows. Consumers must address rows by `phase_event_id`, not only by `phase_type` or displayed position.

## Phase responsibilities

| Phase | Actor | Current purpose | Hedera policy |
|---|---|---|---|
| `trip_creation` | Dispatcher | Commit trip, stops, assignments, consignments, and generated plan | Journey-lock anchor; trip creation fails if it cannot be committed |
| `activation` | Driver | Start the due trip and record verification/location | Not anchored |
| `loading` | Driver, gated by warehouse scan state where configured | Review the driver-safe linehaul and optionally photograph the paper copy | Not anchored |
| `departure` | Driver | Record the applied seal and waybill photo | Pickup anchor; phase can complete while an asynchronous receipt remains owed |
| `in_transit` | Driver on arrival | Close the driving leg with actual arrival time and phone location | Not anchored |
| `unloading` | Driver, gated by warehouse scan state where configured | Verify the arriving seal and record the destination visual count | Not anchored |
| `confirmation` | Driver | Capture POD, signature, and reconciliation outcome | Delivery anchor; phase can complete while an asynchronous receipt remains owed |

The common P0–P6 labels are display shorthand for a two-stop trip. They are not stable API IDs.

## Completion contract

The current route shape is:

```text
POST /api/v1/trips/{trip_id}/phases/{phase_event_id}/complete
```

The request includes a `phase_type` discriminator and an idempotency key. The backend:

1. Loads and locks the requested row.
2. Confirms that it belongs to the authenticated driver's trip.
3. Confirms the trip is active and the row is the next unresolved plan entry.
4. Applies date, scan-feed, artifact, seal, and count rules relevant to that phase.
5. Records the evidence and any exception.
6. Recomputes the trip's current position from the ledger.
7. Publishes a live-update event after commit.

Duplicate submissions with the same idempotency key return the already-completed state rather than repeating an anchor or evidence mutation.

## Status and exceptions

Phase rows use statuses including `pending`, `in_progress`, `completed`, `exception`, and `overridden`. An exception result is evidence, not necessarily a reason to stop recording the trip. For example, a seal mismatch is retained as a critical exception while the remaining evidence flow continues.

A dispatcher can override an unresolved phase with a mandatory explanation. The override remains visible in the ledger; it is not presented as ordinary driver completion. A dispatcher can also cancel a non-terminal trip. Cancellation leaves unfinished phase rows unresolved, preserving the fact that the committed plan was abandoned.

## Evidence anchoring

Three phase types currently produce Hedera receipts:

- `trip_creation` → `journey_lock`
- `departure` → `pickup`
- `confirmation` → `delivery`

Only canonical hashes and receipt identifiers belong on Hedera. Photos, identity data, GPS, signatures, manifests, and other personal or commercial data remain in the configured application stores.

Creation uses a fail-closed policy because no trip should exist without its initial commitment. Departure and confirmation calculate their evidence hash in the request and queue Hedera submission; their `anchor_status` tells the applications whether the asynchronous receipt is pending, anchored, or failed.

## Driver application contract

The driver application receives phase descriptors from the backend and routes current work through:

```text
/trip/phase/{phase_type}/step/{step_slug}
```

Step recipes are keyed by phase type in:

- [`backend/app/core/phase_meta.py`](../backend/app/core/phase_meta.py)
- [`frontend/shared/lib/constants/phase-meta.ts`](../frontend/shared/lib/constants/phase-meta.ts)

A contract test verifies that these definitions agree. The offline queue and draft storage are keyed by phase-event identity and idempotency key so repeated phase types do not collide.

`in_transit` has no step-page recipe. The driver completes it from the in-transit arrival action, which captures location and advances to the next row.

## Current limitation: consignment stop mapping

The plan generator can represent per-stop pickups and deliveries, but the current trip-creation request does not carry pickup and delivery stop references per consignment. Trip creation therefore assigns each new consignment to the first and final stop.

Until that request and dispatcher workflow are extended, the repository must not claim complete intermediate consignment mapping for newly created multi-stop trips. This is a schema and workflow change, not a documentation-only fix.

## Historical terminology

Earlier versions used a fixed numbered custody model and different table and column names. The migration [`2026_07_28_ciaran_phase_model.py`](../backend/migrations/versions/2026_07_28_ciaran_phase_model.py) performs the rename to the current phase model.

Do not edit old migrations merely to remove historical names: a clean database must still be able to apply the original schema and then the rename. Current application code, UI text, tests, and maintained documentation should use `phase`, `phase event`, `arrival`, or `handover` instead.

## Rules for future changes

- Never assume a fixed plan length.
- Never identify a row only by phase type or array index.
- Never insert new phase rows after trip creation without a new integrity design.
- Keep backend and shared frontend phase metadata aligned.
- Record exceptions without silently discarding the rest of the evidence chain.
- Update this document, generated API schemas, and affected tests with any lifecycle change.
