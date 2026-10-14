# Scale Readiness — Iteration 2 Review Response

> **Status:** findings, verified against source 2026-08-18 · **Author:** Ciaran · **Date:** 2026-08-18
> **Artifact (formatted):** https://claude.ai/code/artifact/1ab17454-4242-4809-aca1-bf698ad01788
> **Follow-on:** [iteration3_plan.md](iteration3_plan.md)

Five critiques came out of the iteration 2 presentation. Read against the actual codebase, two
describe problems already solved, and one uncovers a bug that can put the same cargo on two trips.

**The meta-finding:** half of this round's engineering feedback was a *documentation* failure,
not a code failure. The outbox, the row lock, and the offline queue's GPS handling are all
decisions worth more than the features around them, and none were visible from the outside.

> **Dated record — read with [iteration3_plan.md](iteration3_plan.md).** These findings stand as of
> 18 August 2026. Two recommendations were **revised on 24 August** when iteration 3 was scoped: the
> **client analytics grain** and the **`parcel_events` ledger** are both deferred out of iteration 3
> (the client grain on the POPIA cut, replaced by a facility grain; `parcel_events` because the
> derived timeline already answers the reviewer). The findings themselves are unchanged.

---

## 1. Findings ledger

| Verdict | Critique | Finding |
|---|---|---|
| **Already solved** | Pub/sub — what and where | Redis Pub/Sub, org-scoped channel, thin id-only payloads, transactional outbox draining on `after_commit`, consumed by SSE. Asked because it was undocumented in the talk, not because it was missing. |
| **Already solved** | Batched writes and rollback | Orchestration only flushes. The single commit in the request path is in `get_db()`, after the endpoint returns. A mid-request failure rolls back atomically today. |
| **Open bug** | Concurrent waybill assignment | Check-then-act guard with no lock and no unique constraint. Two dispatchers can assign one waybill to two trips, each getting its own journey lock hash. |
| **Confirmed gap** | Analytics | No aggregation layer. But the capture substrate is complete — a read-model problem, not an instrumentation problem. |
| **Confirmed gap** | Parcel history | `Parcel.status` is a mutable column, so "where has it been" is unanswerable. A v1 timeline is derivable from the phase ledger with no migration. |
| **Confirmed gap** | File length | Six files over 1,000 lines. Real, but the worst offenders are hot on other branches — sequencing matters more than the split. |

---

## 2. The two to defend, not fix

### Pub/sub is a transactional outbox

Mechanism lives in `app/core/realtime.py`. Services never publish directly — they call
`enqueue_event()`, which appends to a per-request outbox on `Session.info`; a SQLAlchemy
`after_commit` listener does the actual publish once the data is durable. A rollback discards the
outbox and publishes nothing.

- **Transport:** Redis Pub/Sub, one channel per org (`org:{uuid}`), same Redis that backs Celery.
- **Why it exists:** the API runs multiple workers. The worker handling the driver's write and the
  worker holding the dispatcher's SSE connection are different processes; only a shared broker bridges them.
- **What crosses it:** `{resource, id, kind, ts}` — ids and an enum, nothing else. No GPS, photos
  or parcel detail. A deliberate POPIA decision: the browser refetches the authorised
  `GET /trips/{id}` it already trusts.
- **Producers:** 5 sites — `trip_service.py:426,534`, `phase_service.py:491,575`, `exception_service.py:110`.
- **Consumer:** SSE at `stream.py`, org taken from the authenticated dispatcher, 15 s heartbeat.
- **Failure mode:** publish is fail-open. A Redis outage is logged and swallowed, because the
  commit already succeeded and is the source of truth.

**Real limits to name yourself before the panel does.** Redis Pub/Sub is fire-and-forget, so a
dispatcher offline for 30 s misses those events permanently — reconnect-refetch mitigates but does
not solve it. And `_pending_tasks` is per-process, so in-flight publishes die on deploy. Both are
acceptable *because* the payload is a hint, not data — but that argument only counts if made.

### The interesting rollback problem isn't the database

Transaction discipline already does what the critique asked. Zero `commit()` calls in
`app/orchestration/`; the three `rollback()` calls in `trip_service.py:309-328` are belt-and-braces
so a failed PP sync can't leave an orphan trip.

What genuinely cannot roll back is the **Hedera anchor** — a DB rollback cannot un-submit an
on-chain message. `phase_service.py:146` solves this with a row lock rather than the unique index,
because the index only fires at flush, *after* the anchor is queued. That reasoning is more
sophisticated than the critique it answers.

The signal-drop case the reviewer imagined lives on the **phone**, and
`frontend/driver-pwa/lib/hooks/useOfflineQueue.ts` already handles it: `idempotencyKey` generated
once at enqueue and never regenerated on retry, and the GPS fix stored *with* the entry rather than
re-taken at replay — so a reconnect cannot forge where the driver was.

> **Best thing to read aloud at the next presentation:** the offline queue stores the driver's GPS
> fix with the queued entry rather than re-taking it at replay, because a position recorded when
> signal returned would claim the driver completed the phase wherever they happened to reconnect.

---

## 3. The open bug — one waybill, two trips

In `consignment_service.py:144-156` the reassignment guard reads `consignment.trip_id`, compares to
the incoming trip, and raises `ConsignmentAlreadyAssignedError`. There is no row lock, and the
`Consignment` model declares no `__table_args__` — so `parcel_perfect_reference` carries no unique
constraint either.

Two dispatchers creating trips citing the same waybill concurrently both read a state that permits
the write. The result is the same cargo on two trips, each anchoring its own journey lock hash.

```python
# The fix is structural: make the database refuse it.
op.create_index(
    "uq_consignments_pp_reference",
    "consignments",
    ["parcel_perfect_reference"],
    unique=True,
)
# Then IntegrityError becomes the 409, exactly as vehicle_service.py:64 already does.
# The loser of the race fails at flush, inside the transaction, and rolls back clean.
```

Write the failing concurrency test **first**. Also audit on the same pass: driver/vehicle
double-assignment across overlapping trips, and `trip_reference` generation.

---

## 4. Analytics — the substrate already exists

Nothing needs instrumenting. `exceptions` carries type, source, severity, resolution state and FKs
to trip, phase event, checkpoint, consignment and stop; `phase_events` is append-only, so every
dwell time and delay is derivable; `vehicle_events`, `driver_events`, `trip_location_pings`,
`sla_configs` and `driver_substitutions` sit alongside.

Because the ledger is the truth with position derived from it, every metric is reconstructible and
auditable — a stronger story than a bolted-on metrics table.

**Architecture: read models, not new writes.** See [iteration3_plan.md](iteration3_plan.md) §2 for
the metric definitions carried forward.

---

## 5. File length

| File | Lines | Natural seam |
|---|---|---|
| `tests/unit/test_phase_service.py` | 3,723 | Split by phase, mirroring the service split |
| `tests/integration/test_phases.py` | 1,740 | Split by phase |
| `app/orchestration/phase_service.py` | 1,387 | Six `advance_*` wrappers over one `_finish_phase` |
| `dispatcher/app/(app)/trips/new/page.tsx` | 1,113 | Form sections → components |
| `dispatcher/app/(app)/trips/[id]/page.tsx` | 1,056 | Panels → components |
| `app/integrations/parcel_perfect.py` | 1,069 | Client, mappers, response models |

`phase_service.py` becomes a `phase_service/` package — `_loading.py`, `_transit.py`,
`_confirmation.py`, with shared gate/lock/finish primitives in `_core.py` — public surface
identical so no branch breaks on import.

**Execute post-merge only.** These files are hot on Tim's, Chiko's and Tom's branches; splitting a
1,387-line file mid-sprint is a merge-conflict grenade. Tests first — closest to append-only,
least conflict risk.

---

## 6. Verification status

**Verified in source:** the outbox and `after_commit` listener, the single commit in `get_db()`,
zero `commit()` calls in `app/orchestration/`, the `with_for_update()` on `PhaseEvent`, the absence
of `__table_args__` on `Consignment`, the five `enqueue_event` call sites, the offline queue's
idempotency handling, and every line count.

**Not verified:** the test suite was not run, and no test proving the consignment race was written.
