# Backend bug review, Pass 2 (read-only)

| | |
|---|---|
| Date | 2026-10-20 |
| Checkout in this environment | branch `dev`, commit `b8c44ea` |
| Tree reviewed | `origin/Ciaran` at commit `f4b7360` (exported with `git archive`, not checked out; `backend/` is byte-identical to `dev` for every in-scope file, the two branches differ only in frontend files) |
| Scope | `backend/app/orchestration/` (excluding `substitutions/`), `crypto/`, `blockchain/`, `tasks/` (excluding `driver_substitutions.py`), `db/session.py`, the phase anchor v4 envelope from `be9feb9c`, trip read-model changes in `be9feb9c` where they touch hashing |
| Out of scope | substitution feature, endpoint security/authorisation (Pass 3), structure (Pass 4), frontends |
| Method | static read; no file edited, no pytest, no git write commands, no `.env` read, no Alembic |

Preconditions that did not hold in this environment:

- `docs/audits/2026-10-20-substitution-bugs.md` (Pass 1) does not exist on `origin/Ciaran` or `origin/dev`. Duplicates with Pass 1 could not be screened; substitution code was simply not reviewed.
- No `MEMORY.md` or memory directory exists here. Nothing was read from memory.
- `graphify-out/GRAPH_REPORT.md` was built from `5d906bc5` and is stale relative to `f4b7360`; it was used only to pick communities (61, 72, 75, 94, 160), not as a source of truth.
- `CLAUDE.md` says a single-leg trip is 7 phase rows. `phases/plan.py:57` and `tests/unit/test_phase_plan.py:17` say 8 (an `arrival` row was added). Doc drift, noted under BK-16.

Severity scale: Critical = evidence can be lost or forged silently; High = wrong evidence or state is recorded on a realistic path; Medium = real defect, bounded blast radius or needs a second fault; Low = defect with minor or speculative impact.

---

## Findings

### BK-01 · High · logic · receiver verification verdict is rewritable and files duplicate exceptions

- **File:line** `backend/app/orchestration/handover/receiver_verification.py:497-503`, `backend/app/orchestration/handover/service.py:377-393`
- **What is wrong.** `resolve_verification` writes `identity_match`, `status`, `tier`, `unverified_reason` unconditionally, with no check that the row is still `PENDING` and no row lock. The webhook path has exactly that guard (`ingest_webhook_decision`, lines 617-626: "Already-terminal verifications are annotated, never overwritten") and `start_verification` has it too, but the receiver-driven resolve path does not. `resolve_receiver_verification` then calls `raise_verification_exception` on every call whose verdict carries an exception type, and the resulting `TripException` rows have no uniqueness key.
- **Failure scenario.** Receiver finishes the IDVS flow, returns with typed name/ID that do not match the document, row goes `FAILED` + one `RECEIVER_ID_MISMATCH` exception. Receiver reloads the page and resubmits with different typed values that do match. The same row is overwritten to `VERIFIED`, the earlier mismatch exception stays on the trip with no link to the now-contradicting row, and each further resubmission adds another exception row. The first assessment, which is the evidence, does not stand.
- **Evidence.** Lines 459-512 of `receiver_verification.py` (no status guard, five unconditional assignments then `flush`); `service.py:377` loads with `load_verification_for_token(db, token_id=token.id)` and no `lock=True`; contrast `receiver_verification.py:617-626`.
- **Confidence.** Verified.
- **Suggested fix.** In `resolve_verification`, return the stored verdict without writing when `verification.status != PENDING`, and load the row with `lock=True` on the resolve path.
- **Test that would catch it.** none exists (`tests/integration/test_receiver_verification_endpoints.py::test_resolve_moves_the_row_to_a_terminal_status` covers one call only).

### BK-02 · Medium · logic · dispatcher override has no sequence gate, so a future phase can be pre-resolved

- **File:line** `backend/app/orchestration/phases/override.py:64-72`
- **What is wrong.** `_gate_and_load` refuses a driver completion while any lower-sequence row is unresolved (`gate.py:81-91`). `override_phase` loads the row and checks only that it is `PENDING`/`IN_PROGRESS`; it never looks at lower-sequence rows. The docstring scopes it to "ONE phase the driver physically cannot complete", which implies the current phase.
- **Failure scenario.** Trip at `loading`. Dispatcher overrides `confirmation` (sequence 7) by mistake or intent. Override anchors a `PHASE_OVERRIDE` receipt for confirmation. Driver completes departure, in_transit, arrival, unloading in order; `recompute_position` finds nothing unresolved and sets the trip `CLOSED` with no POD photo, no signature, no scan-in reconciliation, and the "delivery" row carries a dispatcher note dated before the truck left.
- **Evidence.** `override.py:64-72` and `124`; `gate.py:81-91`; `state.py:48-56`.
- **Confidence.** Verified (code path), impact is a judgement call.
- **Suggested fix.** Reuse the lower-sequence check from `gate.py` in `override_phase` (or require the row to be `current_phase_event`).
- **Test that would catch it.** none exists (`tests/integration/test_trip_admin.py` overrides only the current pending row).

### BK-03 · Medium · bug · phase anchor dispatch fires on a SAVEPOINT release, not the outer commit

- **File:line** `backend/app/orchestration/phases/anchor_dispatch.py:81-86`
- **What is wrong.** `_dispatch_anchor` registers `after_commit` with `once=True` and no nested-transaction check. SQLAlchemy fires `after_commit` when a `begin_nested()` savepoint is released (documented in this repo at `core/realtime.py:19-23` and `evidence_anchors/dispatch.py:55-61`, proven by `tests/integration/test_evidence_anchor_recovery.py::test_nested_savepoint_release_does_not_publish_early`). Every wrapper calls `_anchor_phase`/`_dispatch_anchor` before `_finish_phase`, and `_finish_phase` runs `record_separation_finding` / `_persist_driver_location_mismatch`, which open savepoints (`evidence/action_location.py:484, 556`). The evidence-anchor dispatcher fixed this with `run_after_outer_commit` (`evidence_anchors/dispatch.py:66-108`); its docstring at line 4 says it was copied from the phase dispatcher "so the phase path stays untouched", so the phase path still has the defect.
- **Failure scenario.** A handshake whose phone/tracker separation exceeds the limit inserts a finding under a savepoint. On release the phase anchor task is published while the request transaction is still open. The worker's `SELECT ... FOR UPDATE` blocks on the request's row lock, so in the success case it only waits. If the request then fails (for example `_finish_phase`'s flush hits the global idempotency-key index, BK-13, or `get_trip_detail` raises) the request rolls back but the task is already queued: the worker finds the row still `PENDING` with a stale or null `event_hash`, logs "Rejected invalid anchor task", writes `anchor_status = FAILED` on a phase that was never completed, and retries three times doing the same. The row now reports a failed anchor for a phase the driver has not completed.
- **Evidence.** `anchor_dispatch.py:66-86`; `completion.py:84-102`; `action_location.py:484-487, 556-559`; `anchor_execution.py:55-84`.
- **Confidence.** Likely (mechanism verified in-repo; the harmful branch needs a later failure in the same request).
- **Suggested fix.** Route `_dispatch_anchor` through `evidence_anchors.dispatch.run_after_outer_commit` instead of a bare `after_commit` listener.
- **Test that would catch it.** none exists for phases (the evidence-side test above is the template).

### BK-04 · Medium · bug · Parcel Perfect sync reads expired ORM rows after `rollback()`, aborting the whole batch

- **File:line** `backend/app/tasks/parcel_perfect.py:137-147`, loop header at `83-85`, `engine.dispose()` at `149`
- **What is wrong.** On any per-consignment failure the task calls `await db.rollback()` and then logs `consignment.id` and `consignment.parcel_perfect_reference`. `rollback()` expires every instance in the session (`expire_on_commit=False` does not apply to rollback). Reading an expired attribute triggers a refresh, which in an `AsyncSession` outside a greenlet raises `MissingGreenlet`. That exception escapes the `except`, ends the loop, skips `engine.dispose()` (not in a `finally`), and the Celery wrapper retries the whole task. The next iteration's `consignment.pp_raw_json` read at line 84 would fail the same way even if the log line were removed.
- **Failure scenario.** One waybill's PP fetch raises. The sweep that promised to "continue to the next one" (docstring, lines 44-49) crashes instead; no later consignment in that run is refreshed; the engine and its pool are leaked until the process exits; after `max_retries` the beat waits for the next interval.
- **Evidence.** Lines 70-149 as read; `db/session.py` is not used here (fresh engine), so no other code refreshes the rows.
- **Confidence.** Likely.
- **Suggested fix.** Capture `consignment.id` and the reference into locals before the `try`, and move `engine.dispose()` into a `finally`.
- **Test that would catch it.** none exists (`tests/unit/test_pp_task.py` does not drive the failure branch against a real rollback).

### BK-05 · Medium · bug · "fail-open" `except Exception` blocks wrap DB writes with no savepoint, so a DB fault aborts the transaction and the swallow hides it

- **File:line** `backend/app/orchestration/phases/findings.py:88-173` and `203-266`; `backend/app/orchestration/phases/completion.py:84-107`; `backend/app/orchestration/evidence/corroboration.py:419-430`; `backend/app/orchestration/handover/receiver_verification.py:264-290`; `backend/app/orchestration/exceptions/creation.py:66-104`
- **What is wrong.** Each block catches `Exception`, logs, and lets the request continue on the promise that "the handshake stands". That holds for Pulsit or logic errors. For any database error (constraint, encoding, connection) Postgres leaves the transaction in the aborted state; the next statement (`recompute_position` at `completion.py:109`, the flush at `:115`) fails with `InFailedSqlTransaction`, the request 500s anyway, and the logged root cause is now two frames away from the error the client sees. `action_location.record_separation_finding` does this correctly with `begin_nested()` (`:484`), and `exceptions/creation.py:283` does too; the five sites above do not. A second consequence in `findings.py:236`: `register_exception` flushes the CRITICAL `TripException` before it builds the anchor events (`evidence_anchors/recording.py:194-196`). If `prepare_exception_anchors` raises a non-DB error after that flush, the swallow at `findings.py:259` lets the request commit a CRITICAL row with no `EvidenceAnchorEvent`, which the recovery sweep can never find.
- **Failure scenario.** `TRAILER_LOCATION_MISMATCH` insert violates `uq_exceptions_trailer_location_mismatch` because a concurrent writer got there first (`db/models/transit.py:168-173`). The `IntegrityError` is swallowed, the transaction is aborted, `recompute_position` raises, the driver's swipe 500s, and the log says "the handshake stands".
- **Evidence.** Lines cited; `completion.py:81-82` even claims the separation finding "uses its own SAVEPOINT" while the two findings calls above it (`:63-65`) do not.
- **Confidence.** Likely for the aborted-transaction half; Speculative for the orphaned CRITICAL row (needs `prepare_exception_anchors` to raise, which today requires a naive datetime or a foreign artifact).
- **Suggested fix.** Wrap each fail-open write in `async with db.begin_nested():` (the pattern `action_location.py:484` already uses) so the swallow only ever discards the finding's own savepoint.
- **Test that would catch it.** none exists (`tests/integration/test_gps_mismatch.py` exercises the happy path only).

### BK-06 · Medium · blockchain · a Hedera submit that times out can still land on HCS; retry publishes a second message

- **File:line** `backend/app/blockchain/anchor_service.py:89-102`
- **What is wrong.** `asyncio.wait_for(asyncio.to_thread(service.submit_hash, ...))` cancels the awaiting coroutine on timeout but cannot stop the SDK thread. The thread's receipt is discarded, `HederaTimeoutError` is raised, the phase/evidence path marks `FAILED`, and the retry submits the same hash again. For the fail-closed journey lock (`trips/creation.py:525-532`) and the fleet events the whole transaction rolls back, leaving an HCS message with no local record. The error text at `:100-101`, "The change was not saved — please retry", is true for Postgres and false for HCS. `anchor_evidence_event`'s docstring (`execution.py:60-62`) already concedes "exactly-once is not claimed"; no caller surfaces that to an auditor.
- **Failure scenario.** Hedera is slow for 16 s. Departure anchor times out, FAILED, retried 30 s later, succeeds. Topic now holds two identical messages at different sequence numbers; `verify_hash` checks only the stored one, so verification passes, but a `lookup_receipts(data_hash=...)` on the topic-side shows one record for two on-chain messages.
- **Evidence.** `anchor_service.py:85-121`; `anchor_execution.py:119-125`; `execution.py:90-95`.
- **Confidence.** Likely.
- **Suggested fix.** Either record an "attempted at" marker before submit and reconcile duplicates from the mirror node in the sweep, or reword the timeout message and document the at-least-once property in the audit pack.
- **Test that would catch it.** none exists (`tests/unit/test_anchor_service_timeout.py` asserts the exception, not what happened to the thread or to DB state).

### BK-07 · Medium · bug · fleet edits are read-modify-write without a row lock, so the anchored diff can misstate the previous value

- **File:line** `backend/app/orchestration/fleet/drivers.py:142-148`, `backend/app/orchestration/fleet/vehicles.py:136-142`, `backend/app/orchestration/fleet/precincts.py:279`
- **What is wrong.** Each update does a plain `SELECT`, snapshots `old`, applies the patch, flushes, snapshots `new`, and anchors `diff_critical_fields(old, new)`. Two concurrent PATCHes on one row both diff against the same stale `old`; the second anchored event records a `from` value that was never the row's value at that moment. The exception review path locks (`exceptions/review.py:87, 335`); the fleet path does not.
- **Failure scenario.** Two dispatchers change a precinct's radius at once (100 → 150, 100 → 200). Both events anchor `from: 100`; the chain says the radius was 100 immediately before it became 200, which is false, and the audit trail cannot be used to reconstruct the fence at a given time.
- **Evidence.** Lines cited (read via the delegated summary; the `with_for_update` grep over `app/` confirms none of the three fleet modules lock).
- **Confidence.** Likely.
- **Suggested fix.** Load the row `with_for_update()` in the three update functions.
- **Test that would catch it.** none exists.

### BK-08 · Low · bug · one non-Hedera failure in a recovery sweep aborts the whole sweep and the poison row stays at the head of the queue

- **File:line** `backend/app/tasks/blockchain.py:108-113`, `backend/app/tasks/evidence_anchors.py:82-87`, `backend/app/orchestration/phases/anchor_recovery.py:43-52`, `backend/app/orchestration/evidence_anchors/recovery.py:39-40`
- **What is wrong.** Each attempt runs in `async with session_factory() as db, db.begin()`. `updated_at` is bumped inside that transaction to rotate the row to the back. Only Hedera errors and the two reconstruction errors are caught; anything else (a DB error, an enum value the rebuild does not know) rolls the attempt back, including the `updated_at` bump, and propagates out of the `for` loop, so the remaining 19 attempts never run. The next beat picks the same row first.
- **Confidence.** Speculative (needs an unexpected exception type).
- **Suggested fix.** Catch and log per attempt inside the loop, and commit the `updated_at` rotation in its own short transaction before the attempt.
- **Test that would catch it.** none exists (the coverage inventory found no test of `_recover_anchors` / `_recover_events`).

### BK-09 · Low · logic · the idempotency-key unique index is global, so a reused key on a different phase row becomes a 500 instead of a 409

- **File:line** `backend/app/db/models/phases.py:45-50`, `backend/app/orchestration/phases/completion.py:43`, `backend/app/orchestration/phases/loaders.py:53-58`
- **What is wrong.** `uq_phase_events_idempotency_key` is unique across all trips. `_find_own_completion` matches on `(phase_event_id, key, driver)`, so a key already used on another row is not recognised as a replay; the wrapper runs, `_finish_phase` sets `event.idempotency_key`, and the flush raises `IntegrityError`. Nothing maps that to a conflict response.
- **Failure scenario.** An offline-queue bug resends the departure's key with the arrival's `phase_event_id`. The driver gets a 500 and the queue entry never drains.
- **Confidence.** Likely.
- **Suggested fix.** Check for a foreign owner of the key before the wrapper runs and raise a 409, or scope the index to `(trip_id, idempotency_key)`.
- **Test that would catch it.** none exists.

### BK-10 · Low · bug · `create_driver` creates the Supabase auth user before any DB write, so a later failure orphans it

- **File:line** `backend/app/orchestration/fleet/drivers.py:78-124`
- **What is wrong.** `create_driver_auth_user` is an external call made before `db.add`. A flush `IntegrityError` other than the handled duplicate, or a Hedera failure at the anchor on line 124, rolls back the DB but not Supabase; the retry hits a Supabase 422 for the phone number.
- **Confidence.** Speculative (read via the delegated summary; code path consistent with the comment at `:61-65`).
- **Suggested fix.** Create the auth user after the flush succeeds, or delete it on rollback.
- **Test that would catch it.** none exists.

### BK-11 · Low · blockchain · consensus timestamp parse failures are silent

- **File:line** `backend/app/blockchain/anchor_service.py:43-58`
- **What is wrong.** `_parse_consensus_timestamp` returns `None` on `ValueError` with no log. A receipt is then stored with `hedera_consensus_timestamp = NULL` and nothing says why. The slicing logic also only handles the `...Z` ISO form; the mirror-node `seconds.nanos` form would fall through to `None`.
- **Confidence.** Verified.
- **Suggested fix.** Log at warning with the raw value when parsing fails.
- **Test that would catch it.** none exists.

### BK-12 · Low · custody · a pre-linked receipt is trusted without being checked on the phase path

- **File:line** `backend/app/orchestration/phases/anchor_execution.py:70-72`
- **What is wrong.** When `event.blockchain_receipt_id` is already set, `anchor_phase_event` writes `ANCHORED` and returns without loading the receipt. The evidence path does the extra check (`evidence_anchors/execution.py:24-31, 73-78`: subject, type and `data_hash == event_hash` must match). A phase row whose link points at the wrong receipt would be laundered to `ANCHORED` by any retry.
- **Confidence.** Speculative (needs a prior corruption).
- **Suggested fix.** Port `_receipt_matches` to the phase path.
- **Test that would catch it.** none exists.

### BK-13 · Low · custody · audit pack custody tier is derived from the link alone, and a missing driver row crashes the pack

- **File:line** `backend/app/orchestration/audit_packs/custody.py:148`, `:151-152` vs `:123`
- **What is wrong.** `tier = "anchored" if s.blockchain_receipt_id is not None` never looks at `anchor_status` or the receipt's hash. `drivers[s.original_driver_id].full_name` raises `KeyError` if the driver is absent from the dict, while `_declarations` (line 123) falls back to "Unknown driver" for the same situation.
- **Confidence.** Verified.
- **Suggested fix.** Use `anchor_status == ANCHORED` for the tier and the same "Unknown driver" fallback in `substitution_records`.
- **Test that would catch it.** none exists for `custody.py` directly.

### BK-14 · Low · bug · `review_exceptions_batch` indexes `rows[0]` without an emptiness check

- **File:line** `backend/app/orchestration/exceptions/review.py:341`
- **Confidence.** Speculative (cited by the delegated summary; not independently read; whether the schema forbids an empty list was not checked).
- **Suggested fix.** Return early on an empty `exception_ids`.
- **Test that would catch it.** none exists.

### BK-15 · Low · blockchain · worker logs lose the Hedera error detail

- **File:line** `backend/app/orchestration/evidence_anchors/execution.py:90-95`
- **What is wrong.** Only `type(error).__name__` is logged; the phase path (`anchor_execution.py:121-123`) logs the exception with traceback. Diagnosing a `HederaSubmitError` from the evidence worker is harder than it needs to be.
- **Confidence.** Verified.
- **Suggested fix.** `logger.exception(...)` as in the phase path.
- **Test that would catch it.** not a test concern.

### BK-16 · Low · recent-change / docs · stale statements that will mislead the next reader

- `CLAUDE.md` "single-leg = 7 rows" vs `phases/plan.py:57` and `tests/unit/test_phase_plan.py:17` (8 rows, 13 for a 3-stop cross-dock).
- `tests/integration/test_trip_admin.py:271-278` docstring: "An activation is never anchored". Every phase has anchored since 2026-09-23 (`plan.py:13-17`). The assertion still passes, the reasoning is stale.
- `phases/completion.py:81-82` says the separation finding "uses its own SAVEPOINT"; the two findings called just above it do not (BK-05).
- **Confidence.** Verified.

---

## Question-by-question summary

**A. Bugs (error handling, transactions, races).** Commit ownership is clean: orchestration only flushes, `get_db()` commits/rolls back (`db/session.py:54-62`), Celery tasks commit their own sessions. The row-lock discipline on the phase path (trip `FOR NO KEY UPDATE`, then phase `FOR UPDATE`, `loaders.py:89-103`) is sound and prevents double completion. Defects: BK-01 (no lock, overwrite), BK-03 (publish before outer commit), BK-04 (ORM after rollback), BK-05 (swallow without savepoint), BK-07 (lost update), BK-09 (500 instead of 409).

**B. Phase logic.** Driver completions are validated against the plan (`gate.py:81-91`) and never against `trip.status` except to refuse CLOSED/CANCELLED/EXCEPTION_HOLD. Replay of a resolved row returns current state and writes nothing (`gate.py:33-52`); a resolved row cannot be re-executed. Position is recomputed from the ledger (`state.py:34-56`). The one hole is BK-02: a dispatcher override skips the sequence gate.

**C. Custody and hashing.** Every phase payload builder is an explicit whitelist with a fixed key set and `None`-not-missing semantics (`payloads.py`), canonicalised with `json.dumps(sort_keys=True, separators=(",",":"))` in three identical copies (`crypto/hashing.py:48-54`, `anchor_service.py:32-40`, `verification/phase_payloads.py:71-74`). Datetimes are UTC-normalised in the journey lock and evidence payloads; the fleet payloads use plain `isoformat()` of the stored value, which is stable only because asyncpg always returns UTC-aware values. The **v4 envelope** (`be9feb9c`) is additive: it wraps the unchanged v2/v3 payload, is applied only when `performed_by_driver_id` and `custody_sequence` are stamped (`anchor_dispatch.py:55-63`), is rebuilt from the row's live actor fields (`phase_payloads.py:393-402`), and the recovery sweep tries both the bare and wrapped forms (`:415-431`). No existing receipt changes hash; verification reads the version from the receipt, never infers it. The trip read-model changes in `be9feb9c` (current driver in detail/listing) do not touch anything hashed: the journey lock still commits `Trip.driver_id`. An anchor cannot be marked `ANCHORED` with a differing stored hash on the normal path (`anchor_execution.py:74-84` compares before submit) except via the pre-linked shortcut in BK-12.

**D. Crypto.** There is no Ed25519 or PyNaCl code anywhere in `backend/app/` (grep for `nacl`, `ed25519`, `verify_key` finds nothing); `crypto/` contains only `hashing.py`. The only signature verification in scope is the IDVS webhook HMAC (`receiver_verification.py:532-547`, `compare_digest`, fail-closed). SHA-256 usage is consistent. `HederaService.verify_hash` returns `False` on mismatch and raises `HederaVerifyError` on transport failure; `verify_subject` maps those to `HEDERA_MISMATCH` and `ERROR` respectively (`verification/service.py:364-384`), never to success. Only a 64-hex digest is ever sent to HCS (`hedera.py:177-183, 230-236`), so POPIA holds on the wire; `payload_json` (local) does hold plaintext vehicle/precinct business data and an unsalted hash of a driver's licence number.

**E. Blockchain.** Submits run off the event loop with a timeout (BK-06 for the residual). Retries are idempotent at the DB row level (row lock plus linked-receipt short-circuit) but not at the HCS level. A failed anchor never leaves a receipt row (receipt is added only after the SDK returns, `anchor_service.py:104-120`); the journey lock is fail-closed and the rest fail-open with `anchor_status = FAILED` as a durable debt swept every 60 s.

**F. Coverage gaps (rules with no test that would fail if the rule broke).** 13:

1. Concurrent double completion of the same phase row (only `FOR UPDATE` is spied on, `tests/unit/test_phase_service.py:3170`).
2. `get_db()` commit-on-success / rollback-on-exception (no test imports it; every integration test overrides it).
3. `verify_subject` turning a raised `HederaServiceError` from `verify_hash` into `ERROR` (`verification/service.py:375`).
4. v4 envelope golden hash and exact key set; nested-envelope rejection; v4 receipt with nulled actor fields.
5. Phase dispatch on a savepoint release (BK-03); the evidence side has the test, the phase side has none.
6. Repeated `/resolve` on a terminal verification (BK-01).
7. Out-of-order dispatcher override (BK-02).
8. `_recover_anchors` / `_recover_events` loops, batch size, due window and SKIP LOCKED under concurrency.
9. Timeout test does not assert nothing was persisted (`tests/unit/test_anchor_service_timeout.py` uses a bare `MagicMock` db).
10. Phase Celery task retry-on-exception and success path; `_anchor` commit/dispose (`tests/unit/test_blockchain_task_registration.py` covers registration and one retry branch).
11. Receiver sweep idempotency and `unverified_reason == ABANDONED`.
12. Parcel Perfect task failure branch against a real rollback (BK-04).
13. Cross-row idempotency-key reuse (BK-09).

Rules that are covered well (for the record): sequence gate and replay (`test_phase_service.py`, `test_phases.py`), fail-open on Hedera (`test_phase_anchoring.py:270`), anchor idempotency (`test_phase_service.py:3049`, `test_evidence_anchor_concurrency.py:89`), journey-lock golden hashes and timezone normalisation (`tests/baseline/test_b3_canonical_hashes.py`, `tests/unit/test_hashing.py`), tamper detection through rebuilt payloads and live Storage bytes (`test_phase_anchor_payload.py:1005-1102`, `test_trip_verification.py`), evidence dispatch ordering and savepoint handling (`test_evidence_anchor_recovery.py:61-190`).

---

## Notes on out-of-scope files seen in passing (not investigated)

- `backend/app/orchestration/trips/queries.py:221-233` (`_participation`, added in `be9feb9c`): `max(seq for ... if holder == driver_id)` raises `ValueError` on an empty generator if `held_later` can include a substitution whose driver never appears in `custody_holders`. Whether that is reachable depends on substitution row semantics (Pass 1 territory). Also two queries per trip inside a loop.
- `backend/app/orchestration/verification/service.py:252`: `receipt.payload_json["payload_version"]` without a key check on the substitution rebuild path (Pass 1).
- `backend/app/orchestration/handover/service.py:321-342` consent check-then-insert loser becomes a 500 from the unique violation (endpoint behaviour, Pass 3).
- `backend/app/api/v1/endpoints/handover.py` commits explicitly mid-request on several paths (`:343, 376, 415, 460`); any `_dispatch_anchor`-style `after_commit` listener registered earlier in such a request would fire on those commits. No phase code runs there today.

## What was read

Backend application files (61): `crypto/hashing.py`; `db/session.py`; `blockchain/{__init__,hedera,anchor_service,critical_fields,subject_visibility}.py`; `tasks/{__init__,blockchain,evidence_anchors,verification}.py`, `tasks/parcel_perfect.py` (lines 70-153); `core/realtime.py`; `orchestration/integrity.py`; `orchestration/phases/*` (all 27 modules); `orchestration/verification/{service,phase_payloads,receipts,trip_payloads}.py`; `orchestration/audit_packs/custody.py`; `orchestration/evidence_anchors/{dispatch,execution,recovery}.py` and `recording.py:170-221`; `orchestration/evidence/action_location.py` (savepoint/except regions) and `corroboration.py` (except regions); `orchestration/exceptions/creation.py:55-110`; `orchestration/handover/receiver_verification.py:240-300, 459-677` and `handover/service.py:369-393`; `db/models/phases.py` and `db/models/blockchain.py` (constraints and columns); `db/models/enums.py` (grep). Plus `CLAUDE.md`, `graphify-out/GRAPH_REPORT.md` (header and selected communities), the `be9feb9c` diff for every in-scope file, and `tests/integration/test_trip_admin.py:269-307`.

Delegated (Sonnet) and used as leads only: a test-coverage inventory across `tests/unit`, `tests/integration`, `tests/baseline`; summaries of `evidence_anchors/{canonical,artifacts,reads}.py`, `exceptions/review.py`, `trips/creation.py`, `fleet/*`, `tasks/parcel_perfect.py`. Every High finding and every Medium except BK-07 and BK-10 was verified by reading the cited lines directly.

## Not covered

- `orchestration/analytics/*`, `orchestration/consignments/*`, `orchestration/parcel_trace/*`, `orchestration/audit_packs/{access,analysis,anchor_tiers,builder,email_codes,incident_declarations,lifecycle}.py`, `orchestration/evidence/{checkpoints,geofence,location,precinct_assessment,proximity,road_check,attribution,artifacts}.py`, `orchestration/exceptions/{queries,review_identity,review_policy}.py`, `orchestration/trips/{administration,availability,creation (only via summary),detail,listing,route}.py`, `orchestration/handover/capability.py`, `orchestration/verification/{evidence_payloads,fleet_events,substitution_payloads,errors}.py`, `orchestration/evidence_anchors/{canonical,artifacts,reads}.py` (summary only).
- Runtime behaviour: nothing was executed, so BK-03 and BK-04 rest on SQLAlchemy semantics that this repo documents and tests elsewhere, not on a reproduction here.
