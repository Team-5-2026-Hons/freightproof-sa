# Driver Substitution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagent-driven execution is an option only when authorised. Repository prohibitions on agent commits, pushes, merges, rebases and branch switching override skill examples.

**Goal:** Record a complete dispatcher-authorised driver handover while preserving original trip integrity, correct current-driver access, each driver's evidence and a continuous custody history.

**Architecture:** Keep `Trip.driver_id` immutable. Store pending arrangements separately from completed `DriverSubstitution` amendments; derive current ownership from the ordered completed chain. Centralise access and availability rules, persist driver notices, and anchor completed handovers after commit with recoverable debt.

**Tech Stack:** Existing FastAPI, Pydantic v2, async SQLAlchemy 2, Alembic, PostgreSQL, Celery/Redis, Supabase Storage, Hedera, Next.js App Router, TypeScript, React and existing test tools. No new dependency or external provider is assumed.

**Spec:** [Team decision specification](../specs/2026-10-18-driver-substitution-team-decision.md). **Contract:** [API contract v1](../../contracts/driver-substitution-v1.md). **Tim:** [Driver app implementation handoff](2026-10-18-driver-substitution-driver-app.md).

## Handoff and approved decisions

The team approved building FP-83 on 18 October 2026. Ciaran owns everything except modifications inside `frontend/driver-pwa`, which Tim owns. This plan records the subsequent confirmed policies; it does not modify the earlier specification or Word brief. Implementation has not started. Begin at C0, then work through the dependency table below.

Confirmed: any same-organisation dispatcher can complete a handover with missing confirmation and a recorded reason. Normal identity uses the existing verified driver record; unavailable verification needs an admin exception. In-app notices and automatic refresh are required. Background push is excluded from the FP-83 v1 acceptance scope; any reuse of existing native registration still requires a separate demonstrated delivery path and follow-up approval. Do not base scheduling on the earlier developer-day estimate: use the milestones and verification gates here.

Implementation defaults made in this plan: FAILED identity cannot be overridden as unavailable; a material arrangement change cancels and replaces the request; former-driver history uses a separate restricted response; late evidence is retained for dispatcher acknowledgement and cannot advance phases. These decisions avoid inventing verification passes, editing confirmed facts or exposing later live trip data. The original specification remains the historical proposal; this plan and the linked contract record the approved refinements below.

Chosen approach: one integrated custody feature with a contract-first parallel driver-app track. Rejected: overwriting `Trip.driver_id` breaks the original lock; closing/recreating the trip fragments one journey; a dispatcher-only name swap omits custody confirmation and leaves stale access. A cached current-driver column is unnecessary for v1; first share one indexed SQL derivation and optimise only if measured reads require it.

## Eligibility and release decisions

- **Driver verification:** source review found that new fleet drivers start PENDING and no production driver-verification writer is currently exposed. The receiver Didit integration does not verify drivers. Do not assume normal completion is operational merely because VERIFIED exists in an enum. C0 must identify the provenance and supported population path of any genuine VERIFIED records. If none exists, v1 operates through the already approved, separately recorded admin attestation for PENDING drivers; do not add a status dropdown, seed a production pass or build a new verification integration within FP-83. Tests may use explicit VERIFIED fixtures. Record this operational limitation and ensure an authorised admin is available for the actual demonstration. A future genuine verification workflow is separate scope.
- **Licence default:** an incoming driver's `license_expiry` is required. A date is valid through the end of that date in `Africa/Johannesburg`, so expiry equal to the SAST exchange date is allowed. Reject null or earlier dates when arranging/replacing against the expected exchange date; recheck against the actual server-effective SAST completion date. No dispatcher/admin override bypasses this rule. Valid captures remain saved if eligibility subsequently changes; ownership stays with the outgoing driver. This is a substitution rule, not a rewrite of baseline trip activation policy.
- **Release boundary:** background push, new identity vendors and a general fleet-verification workflow are outside v1. In-app discovery, permission safety, evidence retention, truthful identity, audit attribution and migration safety remain release requirements.
- **Deadline:** before the C0 contract is frozen, Ciaran records the team-confirmed submission/demo date and latest integration cut-off in the C0 checkpoint. No date is inferred from a reviewer or an older estimate. Missing the cut-off keeps new arrangements disabled; it does not justify dropping custody or evidence protections.

## Global Constraints

- Read `CLAUDE.md` in full. Keep original journey parameters immutable; derive phase position from the existing plan-driven ledger.
- Python 3.13+, FastAPI 0.115+, SQLAlchemy 2.0+ async, Pydantic v2, Node 22 LTS, Next.js 15+ App Router, TypeScript 5.5+, React 19+, Tailwind v3.4+. Keep the installed stack; no dependency upgrades within FP-83.
- All driver pages use `"use client"`; preserve `output: 'export'` and Capacitor compatibility. The contract must work in browser and native app.
- Personal data stays in approved SA storage. Only hashes reach Hedera. Driver-facing responses preserve existing restrictions on cargo details and add no identity numbers.
- Endpoints remain thin; services own orchestration. All new model tables have `created_at`, `updated_at` and explicit FKs. Use Alembic, never direct schema edits.
- Do not read or print `.env` or secrets. Do not apply a feature-branch migration to shared Supabase. Test migrations on an isolated PostgreSQL database; a developer applies them from merged `dev` through the agreed process.
- Do not commit, push, merge, rebase, switch branches, rewrite history, discard changes or rebuild Graphify. Human developers own Git integration. Keep unrelated working-tree files intact.
- No vehicle substitution, routing, hours-of-service enforcement, new chat system, fresh external driver-biometric integration or new notification provider.

## Review Focus

1. A stale driver request races the final handover: authorisation must be rechecked after taking the trip lock, not against an earlier SQL snapshot. Tests: C2 and C3.
2. A known former driver retries an already-recorded action: acknowledge only an actor-bound exact replay; do not leak the current trip or accept new progress. Tests: C2 and C4.
3. A pending incoming driver has no active trip, or retains another assignment: notices and collection context must still load without replacing the working trip. Tests: T1 and T2.
4. The driver changes twice and then returns: A → B → C → A creates distinct custody periods and correct historical attribution. Tests: C1, C3 and C7.
5. A trip closes or is cancelled while handover is pending: cancel the arrangement, release its reservation and notify both drivers atomically. Tests: C3 and C6.

## Ownership and sequence

| Owner | Owns | Boundary |
|---|---|---|
| Ciaran | All backend services, schemas, migrations, endpoints and tests; dispatcher; shared types, mocks and constants; API contract; integration | No edits inside `frontend/driver-pwa`; give Tim required changes through his handoff |
| Tim | Driver UI, API wrappers, assignment/history state, capture flows, offline queue, notices, driver tests and native/export checks | No backend, migration, dispatcher or `frontend/shared` edits; request contract changes from Ciaran |
| Both | Contract checkpoint, real-client integration and final demonstration | Neither silently changes wire fields or edits the other's files |

| Milestone | Ciaran track | Tim track | Observable result |
|---|---|---|---|
| Contract ready | C0 (including release/identity checkpoint) | Can start T1 immediately after fixtures/types exist | Fixture-driven incoming/outgoing states visible |
| Transaction safe | C0R | T1/T2 from fixtures | Savepoints cannot publish uncommitted notices |
| Ownership ready | C1 and C2 | T1 and T2 against fixtures | Backend tests prove the correct current driver and reservations |
| Transfer ready | C3, C4 and C5 | T2 and T3 against the contract | Complete transfer and retained late evidence through service tests |
| API ready | C6 | Connect T1–T3 to real endpoints | Dispatcher-arranged transfer reaches both apps |
| Review ready | C7 | T4 | Audit/history/attribution and failure paths demonstrated |
| Release ready | C8 with Tim | T4 with Ciaran | Full regression and two-driver demonstration pass |

No intermediate deployment may enable real substitutions. Stages can be reviewed and exercised locally without exposing a partial permission transition to users.

## File structure and responsibilities

New backend files are scoped to `orchestration/substitutions/`: `access.py` (current ownership and participants), `availability.py` (reservation adapter), `service.py` (arrange/confirm/complete), `reads.py` (role-filtered views), `artifacts.py` (capture ownership), `late_evidence.py` (retention and acknowledgement), `notices.py` (durable driver notices), `canonical.py` (pure versioned commitments), `anchors.py` (submission/recovery) and `termination.py` (pending cancellation on trip termination). Add `__init__.py`; do not turn the feature into a general workflow engine.

Create `db/models/driver_substitutions.py` for supporting records; retain the existing completed `DriverSubstitution` in `db/models/trips.py` to avoid import churn. Create `schemas/driver_substitutions.py`, `api/v1/endpoints/driver_substitutions.py`, `tasks/driver_substitutions.py` and `orchestration/verification/substitution_payloads.py`. Tests use focused `test_driver_substitution_*.py` files described below.

Create shared `types/driver-substitution.ts` and `mocks/driver-substitutions.ts`. Create dispatcher `components/trips/DriverSubstitutionPanel.tsx`, `DriverSubstitutionDialog.tsx`, `LateDriverEvidencePanel.tsx` and `lib/api/driverSubstitutions.ts`, each with matching tests. Reuse existing API transport, forms, evidence viewers and timeline patterns.

Explicitly shared files expected during implementation: `backend/app/db/models/__init__.py`, `backend/app/main.py` and `backend/app/core/config.py`. Also coordinate `backend/app/tasks/__init__.py`, `backend/tests/conftest.py`, `backend/.env.example`, core enums/realtime, shared frontend contracts, phase/evidence services and Tom's analytics view definitions. Coordinate the narrow dev-trigger changes with any current owner; preserve the SQL view definition and its downgrade behaviour. One new setting, `DRIVER_SUBSTITUTIONS_ENABLED`, defaults false and gates new arrangements only. Add its empty key to `backend/.env.example` per project policy; do not read or edit real `.env`. No package-manifest or requirements change is planned.

## C0 Publish the shared contract and fixtures

**Owner:** Ciaran. **Depends on:** none. **Fence:** contracts and tests only; no live transfer route or driver-app edits.

**Files:** create the two shared files listed above and `frontend/dispatcher/lib/trips/driver-substitution-contract.test.ts`; modify `frontend/shared/lib/types/trip.ts`, `phase.ts`, `blockchain.ts` and existing mock trips only as required for additive fields; create `backend/app/schemas/driver_substitutions.py` and `backend/tests/unit/test_driver_substitution_schemas.py`. Add the default-false setting to `backend/app/core/config.py`, its empty example key and focused config tests in `backend/tests/unit/test_config_validation.py`; a field-local validator maps a blank value to false so copying the empty example does not break startup. Do not change global settings parsing. The dispatcher test imports the shared fixtures so the existing Vitest root discovers it without a configuration change.

**Interfaces:** publish the exact request/response types and errors in the API contract. All types named in the API contract must match Python and TypeScript, including `DriverSubstitutionContextRead`, `SubstitutionCorrectionRead`, `CustodyIntegrityRead`, `SubstitutionCompletionRead`, `LateEvidenceDetailRead`, `DriverAccess`, `DriverParticipationHistoryRead` and all request bodies/unions. Use a substitution-specific seal condition type rather than broadening the existing phase `SealCondition`. Publish named fixtures for every contract state before Tim starts.

- [x] Write schema tests rejecting partial coordinates, invalid state/role/condition, duplicate vehicle IDs, malformed identity overrides and oversized text. Cross-trip vehicle membership is tested against the DB in C4. Add fixture assertions for incoming-with-no-active-trip, cancelled/replaced, former-participant, per-vehicle not-applicable reason, identity FAILED, missing/expired licence, saved-but-blocked confirmation, clarification, custody-integrity debt and flag-off states. Verify the endpoint/status/code matrix, not just error text.
- [x] Run `cd backend && pytest tests/unit/test_driver_substitution_schemas.py -q`; record the expected missing-contract failure before implementing the schemas.
- [x] Implement the contract schemas and typed fixtures. Add fields with compatible defaults to existing ordinary-trip mocks. Define remaining-stop and relevant-finding DTOs by reusing existing driver-safe stop/exception schemas rather than inventing parcel data. Test the new-arrangement setting as absent, blank, false and true; disabled is the default and never disables completed-chain reads.
- [ ] Run the schema tests; in both frontend packages run `npm run type-check`. Run `cd frontend/dispatcher && npm test -- lib/trips/driver-substitution-contract.test.ts`, without adding dependencies.
- [ ] Record the source of genuine verified-driver records or the explicit PENDING/admin-only operational path, the confirmed submission/demo date, the integration cut-off, and who will supply the admin at demonstration. Do not invent dates or mark this checkpoint complete without the team's actual information.
- [ ] Walk the fixture pack with Tim: field names, nullability, final-confirmation result, artifact payloads and conflict behaviour. Record the contract checkpoint here. Tim may now execute T1 and T2 without waiting for backend delivery.

**Done:** both consumers can render the complete workflow from fixtures. The API contract is the agreed integration boundary, and identity provenance plus the release cut-off are recorded. No new verification service is implied.

## C0R Fix outer-transaction event publication

**Owner:** Ciaran. **Depends on:** none; must pass before C2/C3 mutations or C6 notice integration. **Fence:** repair the existing transaction hook narrowly; no broker replacement or product behaviour expansion.

**Files:** modify `backend/app/core/realtime.py`; extend `backend/tests/unit/test_realtime_emit.py` and create `backend/tests/integration/test_realtime_transactions.py` for real PostgreSQL transaction boundaries. Coordinate this shared hook before editing.

**Evidence:** the existing Session `after_commit` listener drains the session outbox on savepoint release while the outer transaction is still open. A local reproduction queued an event before `begin_nested()`, released the savepoint and observed publication before rolling back the outer transaction. Merely avoiding enqueue calls inside savepoints does not fix it.

- [x] Write failing tests: enqueue before and inside a successful savepoint produces no publication until outer commit; outer rollback publishes nothing; nested rollback discards that savepoint's events while retaining earlier parent events; a successful inner savepoint followed by another rolled-back savepoint retains only committed-scope events; repeated registration does not duplicate publication; ordinary non-nested commit still publishes once.
- [x] Run the focused hook tests and capture the savepoint failure before modifying the hook. Mock only the publisher in unit tests, not SQLAlchemy transaction callbacks.
- [x] Make outbox ownership transaction-aware so publication occurs once after the outermost successful commit. Handle savepoint commit/rollback without draining or clearing the parent's pending events. Keep notices as durable DB rows and preserve existing dispatcher events.
- [ ] Run `cd backend && pytest tests/unit/test_realtime_emit.py tests/integration/test_realtime_transactions.py -q` with PostgreSQL cases executing; then run existing realtime integration tests. Add C3/C6 rollback tests using the repaired hook rather than replacing it with an unconditional mock.

**Done:** a savepoint cannot expose an uncommitted lifecycle event; an outer rollback leaves no published event or durable notice.

## C1 Add storage and deterministic custody derivation

**Owner:** Ciaran. **Depends on:** C0. **Fence:** no rewrite of existing trip parameters, historical actors or old receipts.

**Files:** create `backend/app/db/models/driver_substitutions.py`, `backend/app/orchestration/substitutions/{__init__,access}.py`, `backend/tests/unit/test_driver_substitution_custody.py`, `backend/tests/integration/test_driver_substitution_models.py`, `test_driver_substitution_migration.py`; modify `backend/app/db/models/trips.py`, `backend/app/db/models/__init__.py`, `backend/app/db/models/phases.py`, `backend/app/db/models/transit.py`. Create a Ciaran-named migration under `backend/migrations/versions/` after checking the current head; never edit an existing migration or invent a revision predecessor in this plan.

**Storage decisions:**

- `DriverSubstitutionRequest`: trip, outgoing/incoming drivers, expected exchange point/time, reason, planned flag, `arranged_by_user_id`, version, state, replacement reference and terminal reason/time. One pending request per trip through a partial unique index. Material changes create a new request and cancel the old one.
- `DriverSubstitutionConfirmation`: one immutable capture per request and authenticated role, with separate captured/received times, location availability, typed seal-check snapshot and driver note. Supporting `DriverSubstitutionConfirmationArtifact` links capture evidence with explicit artifact and vehicle FKs and ordering. Uploaded artifacts can be retained before confirmation; associate their request/actor/purpose explicitly, not as a fabricated phase.
- `DriverSubstitutionNotice`: recipient, request, kind and read time; unique recipient/request/kind. `LateDriverEvidence` and `LateDriverEvidenceArtifact`: actor, custody sequence, typed original payload, retained hashes, times, attachments and acknowledgement fields. All new tables include timestamps.
- `DriverSubstitutionCorrection`: immutable clarification linked to a completed substitution, author, reason, note, server timestamp, frozen payload/hash and anchor status/receipt. It cannot edit custody or original facts.
- `DriverSubstitutionOperation`: feature-scoped idempotency record with exactly one authenticated actor FK, action, client request ID, body digest, request/evidence references and a typed result snapshot. Enforce actor/action/key uniqueness with the relevant partial indexes. This records multiple operations over a request's lifetime; one mutable last-key column on the request is insufficient. Replays authenticate and tenant-scope the caller before returning the original safe result.
- Extend completed `DriverSubstitution` with `request_id`, `sequence_number`, `previous_substitution_id`, frozen identity/attestation facts, `payload_version`, `payload_json`, `event_hash`, `anchor_status`, `updated_at`. Keep `substitution_at` as the server-effective time. New rows require a request and positive per-trip unique sequence; `request_id` is unique when non-null and remains null for genuine legacy rows. Do not fabricate historical requests or confirmations.
- **Existing-column mapping:** `original_driver_id` is that event's outgoing driver; contract `incoming` maps to existing `substituting_driver_id`; `exchange_location` retains the human label while the request freezes coordinates/instructions; `approving_dispatcher_user_id` records the arranging dispatcher on new rows, never a driver or whichever dispatcher later completes. Preserve its recorded approval meaning on legacy rows without inferring an unknown arranger. Add nullable `completed_by_driver_id` and `completed_by_user_id`: exactly one is required on new rows, according to whether the final driver confirmation or dispatcher action triggered completion. Legacy completion actors may remain unknown. Driver confirmations retain their own actors; an identity attestation separately records its admin user, reason and server time. Missing-confirmation reason belongs to the completing dispatcher. Freeze these distinct facts in the commitment and audit.
- New substitutions have `exception_id = NULL`; they are amendments, not automatically exceptions. Preserve genuine legacy exception links and existing `blockchain_receipt_id` references. Update the stale model description accordingly. Identity snapshots preserve the actual status/source/timestamp available at completion; unavailable/admin-attested is never relabelled VERIFIED.
- Add nullable `performed_by_driver_id` and `custody_sequence` to new phase actions and driver-raised exception records. Existing artifacts and location pings already store actor IDs. Leave legacy unknown values null. Do not backfill historical actors from whichever driver is current today.

**Interfaces:** `CurrentCustody(driver_id: UUID, sequence: int, substitution_id: UUID | None)`; `get_current_custody(db: AsyncSession, *, trip: Trip) -> CurrentCustody`; `current_driver_id_expression(*, trip_id: SQLColumnExpression[UUID], original_driver_id: SQLColumnExpression[UUID]) -> ColumnElement[UUID]`; `participant_driver_ids(db: AsyncSession, *, trip_id: UUID) -> set[UUID]`.

Unit-test the pure `derive_custody(original_driver_id: UUID, completed: Sequence[CompletedCustodyLink]) -> CurrentCustody` used by the DB helper. `CompletedCustodyLink` contains `id`, `sequence_number`, `previous_substitution_id`, `outgoing_driver_id`, `incoming_driver_id` and `effective_at`; pending requests are never passed as completed links. SQL ordering and the pure helper must agree.

- [ ] Write tests: no amendments resolves original/sequence 0; pending/cancelled requests do not change custody; A→B→C→A resolves A/sequence 3; broken previous links and outgoing continuity fail; ties in timestamps cannot change sequence order.
- [ ] Run the focused new tests and confirm the intended missing-model/helper failure.
- [ ] Implement models, constraints and indexed derivation. Migration preflight must inspect whether legacy completed substitution rows exist; migrate only an unambiguous valid chain, otherwise stop for reviewed data handling. Validate outgoing continuity and chronology from the original driver, assign deterministic sequences only where justified, and retain nullable legacy request/actor facts. A timestamp tie with more than one possible chain is ambiguous; UUID order is not evidence of custody. Preserve legacy receipt/payload versions and explicitly test how a new amendment follows a migrated legacy link before allowing that trip to transfer; never invent a prior anchor/hash. Do not assume the table is empty.
- [ ] Test upgrade and downgrade on an isolated PostgreSQL database, preserving seeded legacy rows and existing FKs. Inspect every migration operation; do not use the shared development database. Existing test `create_all` coverage is insufficient proof of migration correctness.
- [ ] Run `cd backend && pytest tests/unit/test_driver_substitution_custody.py tests/integration/test_driver_substitution_models.py tests/integration/test_driver_substitution_migration.py -q` with integration tests actually executing.

**Done:** database tests show deterministic custody and immutable historical facts; ordinary trips still resolve their original driver.

## C2 Centralise access and update availability

**Owner:** Ciaran. **Depends on:** C1 and C0R. **Fence:** do not replace every occurrence of `Trip.driver_id`; creation and original-lock reconstruction intentionally retain it.

**Files:** extend `substitutions/access.py`; create `substitutions/availability.py`, `tests/integration/test_driver_substitution_access.py`, `test_driver_substitution_availability.py`, `test_driver_substitution_concurrency.py`; modify `orchestration/trips/{availability,queries,route}.py`, `phases/{loaders,scheduling,gate,service}.py`, `evidence/{location,artifacts,checkpoints,action_location}.py`, `exceptions/creation.py`, `handover/service.py`, `consignments/manifest_reads.py`, `core/exceptions.py` and the corresponding endpoint error mappings. Add custody sequence to `schemas/{phases,evidence,transit,handover}.py` and the existing location/checkpoint schemas where their request types are defined. Include `trips/creation.py` only where its availability consumer needs the new effective-driver result.

**Interfaces:** `require_current_driver(db: AsyncSession, *, trip_id: UUID, driver_id: UUID, lock: bool = False) -> Trip`; participant-scoped history reads use separate helpers. `busy_crew_in_window` keeps its public contract while accounting for completed custody and pending incoming reservations.

- [ ] Write an access matrix covering every live write listed above: current allowed, pending incoming forbidden except dedicated capture, former coded conflict, unrelated 404. Include exception reporting, route/linehaul reads and receiver-link issuance; these must not be missed by the original eleven-check estimate.
- [ ] Run the new matrix and existing driver-access tests to establish the failing cases.
- [ ] For mutations, load/lock the trip first, then resolve current custody in a fresh statement and check actor authority. Do not filter ownership before the lock and trust a stale read. Trip → driver rows in sorted UUID order → vehicle rows in sorted order when needed → request → phase is the feature lock order. Reuse/extend the existing phase `_lock_trip` helper's PostgreSQL `FOR NO KEY UPDATE` mode (`with_for_update(of=Trip, key_share=True)`), not stronger `FOR UPDATE`: phase/receipt FK inserts take KEY SHARE and the anchor worker must remain compatible. Use `FOR NO KEY UPDATE` for driver/vehicle/request/phase row serialization when keys do not change, with all multi-row driver/vehicle sets sorted before locking. Availability checks of other trips are non-locking; do not lock another trip while holding crew locks. Verify every participating creation/activation/handover path follows this order, rather than changing one service alone.
- [ ] Preserve actor-bound exact replays without returning a former driver unrestricted current detail. New writes from former drivers get the contract's conflict. Add the contract's nullable `custody_sequence` to existing live-write schemas and artifact forms: accept omitted sequence only before any substitution; reject stale context even when A is current again after A→B→A. Check exact accepted retries before rejecting their old sequence, and never acknowledge another actor's key as the caller's successful action.
- [ ] Make creation, activation and the wizard use effective current occupancy. Pending incoming reservations cover `[expected_at, planned_end)`; open-ended or overrun live trips remain occupied until termination. Once overdue, an uncompleted reservation starts no later than now and remains effective until cancelled/completed; the outgoing driver remains occupied until effective transfer. Keep vehicle occupancy unchanged.
- [ ] Test creation/activation racing substitution; two trips reserving the same driver; exact boundary times; overrun; request replacement/cancellation; and a former driver becoming free. Use independent PostgreSQL sessions and bounded timeouts so a deadlock is a failure rather than a hung suite. Include the real anchor-worker receipt/FK insertion racing phase completion and handover; assert all operations terminate, no duplicate ownership and no receipt loss.
- [ ] Run the three focused integration files plus `tests/unit/test_trip_availability.py`, `tests/integration/test_trip_availability_endpoint.py`, `test_trips_driver_active.py`, `test_trips_driver_list.py`, `test_phases.py`, `test_artifacts.py`, `test_locations.py`, `test_exceptions.py` and `test_handover_endpoints.py` where present. Record any pre-existing failures separately.

**Done:** backend assertions prove the role transition and reservation rules, including concurrency. No real transfer is exposed yet.

## C3 Build the handover lifecycle

**Owner:** Ciaran. **Depends on:** C0R and C1–C2. **Fence:** no additional trip phases or physical dispatch control; no new external identity check.

**Files:** create `substitutions/service.py`, `termination.py`, `tests/integration/test_driver_substitution_service.py`; modify `trips/administration.py`, `phases/completion.py` and the new capture models. `notices.py` records transactional notice rows; HTTP delivery is C6.

**Interfaces:** async services `arrange_substitution(db, *, trip_id, actor: UserRead, payload: ArrangeSubstitutionRequest) -> SubstitutionRequestRead`, `confirm_substitution(db, *, trip_id, request_id, actor: DriverRead, payload: ConfirmSubstitutionRequest) -> SubstitutionRequestRead`, `complete_attested_substitution(db, *, trip_id, request_id, actor: UserRead, payload: CompleteSubstitutionRequest) -> SubstitutionRequestRead`; cancel/replace use their named request schemas with the same dispatcher actor boundary. `cancel_pending_for_terminal_trip(db, *, trip: Trip, reason: str) -> None` is a leaf helper and does not import phase completion.

- [ ] Write failing tests for arrange, one confirmation, final confirmation, eligible normal completion, cancel, atomic replacement, exact replay and stale version. Assert original trip ID, original driver and phase sequence do not change.
- [ ] Implement tenant/driver eligibility, immutable capture ownership, version checks and body-digest idempotency. All successful state transitions and notice rows commit atomically. Replacement invalidates old confirmations by creating a new request ID.
- [ ] Snapshot the incoming fleet identity status at confirmation and recheck at completion. Valid captures may remain saved pending an identity decision; do not lose them because completion is blocked. VERIFIED permits normal completion; PENDING requires admin attestation; FAILED refuses transfer. A missing-confirmation override alone does not bypass identity, account, licence or availability checks. Read existing verified-record provenance from the C0 checkpoint; an enum value alone is not verification evidence. Enforce the licence dates/null policy above at arrange/replace and actual completion. Record expiry and eligibility observation time in completed facts without exposing licence identifiers to drivers. If multiple checks block a saved confirmation, return the contract's deterministic first blocking reason.
- [ ] Complete automatically on the final valid driver confirmation. Recheck current outgoing driver, live trip state, request version and available incoming driver under the agreed locks; append exactly one completed amendment with the next sequence. Add actual server-effective time separately from claimed exchange time. If both confirmations were saved while eligibility was blocked, a new dispatcher `/complete` action can re-evaluate them after the blocker is resolved, without re-uploading or editing captures. Exact retries return their original result; they are not a new eligibility check. Completion mode is normal when both captures and verified identity suffice, and dispatcher-attested only when an exception was actually used; always record the triggering actor separately.
- [ ] Implement `correct_completed_substitution(db, *, trip_id, substitution_id, actor: UserRead, payload: CorrectSubstitutionRequest) -> SubstitutionCorrectionRead` as a new immutable clarification with its own anchor commitment. It never changes the old drivers, effective time or derived current ownership. Test note retries and an attempted correction of another organisation's record.
- [ ] Compare separate driver seal captures by vehicle and record established evidence findings for discrepancies. Use existing location accuracy, tracker freshness and separation rules through an exchange-context adapter; do not invent a precinct/phase for a free-text point. Test tracker outage and missing location as explicit unassessed states without losing captures. A substitution is never itself an exception; preserve existing holds and review requirements.
- [ ] On trip cancellation or normal closure, cancel pending requests and release reservations in the same transaction. If completion won the race, preserve the completed transfer and close the trip under its correct current driver.
- [ ] Run `cd backend && pytest tests/integration/test_driver_substitution_service.py tests/integration/test_driver_substitution_concurrency.py tests/integration/test_trip_admin.py -q`. Include both role policies: ordinary dispatcher may attest missing captures; only admin may attest unavailable identity. Test FAILED identity refuses even an admin; null/expired licence refuses both; equal-date expiry succeeds until SAST midnight; expected-valid but actual-expired takeover remains pending with saved captures. Test a driver/account becoming inactive between arrangement and completion.

**Done:** service tests show full and attested transfers, chained substitutions and correct termination behaviour.

## C4 Preserve capture ownership and late evidence

**Owner:** Ciaran. **Depends on:** C2–C3. **Fence:** late submissions never call ordinary phase completion or overwrite a current driver's state.

**Files:** create `substitutions/artifacts.py`, `late_evidence.py`, `tests/integration/test_driver_substitution_artifacts.py`, `test_driver_substitution_late_evidence.py`; modify `orchestration/evidence/artifacts.py`, relevant schemas and dispatcher read support. Reuse the existing MIME, size, hashing and storage pipeline behind dedicated authorisation; do not bypass it for incoming drivers.

**Interfaces:** `create_substitution_artifact(db, *, trip_id, request_id, driver: DriverRead, role: SubstitutionRole, upload: ValidatedArtifactUpload) -> EvidenceArtifactRead`; `retain_late_evidence(db, *, trip_id, driver: DriverRead, payload: LateEvidenceRequest) -> LateEvidenceRead`; `acknowledge_late_evidence(db, *, trip_id, evidence_id, actor: UserRead, payload: AcknowledgeLateEvidenceRequest) -> LateEvidenceRead`. `ValidatedArtifactUpload` contains the existing size-checked bytes, MIME/type, capture time and optional location; token supplies capturer.

- [ ] Write failing tests for pending incoming upload, former late upload, wrong trip/role/vehicle, citing another driver's artifact, duplicate bytes/request, changed body under the same key and expired/cancelled request.
- [ ] Bind uploaded artifacts to request, actor and purpose before accepting confirmation; pre-confirmation upload associations must not appear as submitted confirmations. A photo from the outgoing driver cannot satisfy the incoming driver's independent capture. Review phase deduplication too: after takeover, a hash match against A's artifact must not silently relabel it as B's capture. Preserve unused uploads when a request is cancelled; restrict their visibility.
- [ ] Store late payloads through the typed union and artifact associations, preserving original claimed time, actual receipt time, actor and claimed custody sequence. Verify that the actor participated; never infer authority just from a phone timestamp. Store an immutable payload hash. Acknowledgement changes only review fields.
- [ ] Prove original accepted-action replays produce a specific acknowledgement; new post-handover queued work produces a retained late-evidence receipt. Unknown or conflicting drafts remain reviewable and are not silently submitted as another driver.
- [ ] Run `cd backend && pytest tests/integration/test_driver_substitution_artifacts.py tests/integration/test_driver_substitution_late_evidence.py tests/integration/test_artifact_upload_concurrency.py -q`.

**Done:** the backend supports Tim's durable queue without dropping evidence or granting former-driver live permissions.

## C5 Anchor custody and freeze action attribution

**Owner:** Ciaran. **Depends on:** C1, C3 and C4. **Fence:** keep original trip hash reconstruction and all historical payload versions valid.

**Files:** create `substitutions/{canonical,anchors}.py`, `tasks/driver_substitutions.py`, `verification/substitution_payloads.py`, `tests/unit/test_driver_substitution_payloads.py`, `tests/integration/test_driver_substitution_anchors.py`, `test_driver_substitution_verification.py`; modify `db/models/enums.py`, `blockchain/subject_visibility.py`, `verification/{service,phase_payloads}.py`, `phases/{gate,anchor_dispatch,anchor_execution,payloads}.py`, `tasks/__init__.py`, existing phase-anchor tests and task-isolation fixtures in `tests/conftest.py`.

**Interfaces:** `compute_substitution_payload(*, record: CompletedSubstitutionRecord) -> CanonicalSubstitutionPayload`; `anchor_driver_substitution(db, *, substitution_id: UUID) -> bool`; `verify_custody_chain(db, *, trip_id: UUID, organization_id: UUID) -> CustodyIntegrityRead`. Define the record dataclass from the persisted completed facts and the canonical typed result with `payload_version=1`, `event_type`, opaque trip/event IDs, sequence, previous event hash and `record_sha256`. Add subjects `driver_substitution` and `driver_substitution_correction` to both registries and frontend receipt types; corrections use receipt type `driver_substitution_corrected` and an independent record commitment.

- [ ] Write deterministic-payload and privacy tests. The local record commits to both driver captures, identity snapshot, missing confirmations, approver/reasons, sequence and previous event hash. The versioned canonical payload contains hashes and opaque references, never free-text PII or GPS.
- [ ] Persist the payload commitment atomically with completion. Queue after commit; register the task and periodic recovery using existing Celery patterns. Test rollback publishes nothing, duplicate workers create no second receipt, lost dispatch is recovered, edited sources are refused, and an outage leaves pending/failed debt without reversing custody.
- [ ] Reconstruct from live source records and re-hash referenced stored bytes; comparing a frozen JSON blob to itself is not verification. Cross-check completed requests and trip-linked receipts as well as remaining substitution rows so deleting the newest amendment cannot make the shortened chain appear complete. Check ordered continuity, previous hash, missing rows, exact subject/receipt kind and current metadata tampering.
- [ ] Stamp new driver phase actor and custody sequence in the completion gate after replay checks and before wrapper anchoring. Introduce phase payload v4 as an envelope around the existing versioned evidence payload plus an actor commitment and custody sequence. Preserve v1/v2/v3 reconstruction exactly; new receipt version controls reconstruction. Dispatcher overrides keep their explicitly recorded dispatcher actor and do not invent a driver capture.
- [ ] Include new driver-raised exception actors in evidence payload v2 while preserving evidence payload v1 reconstruction. Modify `orchestration/evidence_anchors/{canonical,recording}.py` and `verification/evidence_payloads.py`; preserve review/cancellation commitments referencing v1 raises. Legacy missing actor remains unknown. Update the existing isolated task fixture so tests never publish new jobs to the development broker. Corrections use the same after-commit/recovery discipline with independently verifiable receipts.
- [ ] Run the new payload/anchor/verification tests plus `tests/integration/test_trip_verification.py`, `test_phase_anchoring.py`, `test_every_phase_anchoring.py`, `test_evidence_anchor_verify.py` and registry coverage tests. Prove no-substitution trips and old receipts still verify.

**Done:** the original journey and every custody amendment verify, while actor attribution cannot be silently relabelled after transfer.

## C6 Expose role-filtered reads, durable notices and HTTP routes

**Owner:** Ciaran. **Depends on:** C2–C5. **Fence:** persistent notices and automatic refresh are the v1 delivery scope; background push is excluded.

**Files:** create `substitutions/{reads,notices}.py`, `api/v1/endpoints/driver_substitutions.py`, `tests/integration/test_driver_substitution_endpoints.py`, `test_driver_substitution_reads.py`, `test_driver_substitution_notices.py`; modify `main.py`, `core/realtime.py`, `orchestration/trips/{detail,listing,queries}.py`, `orchestration/fleet/drivers.py`, `schemas/trips.py`, existing driver-list tests and dispatcher realtime type/ranking consumers.

**Interfaces:** the exact routes and DTOs in the contract, plus `get_driver_substitution_assignments(db, *, driver_id: UUID) -> list[SubstitutionRequestRead]` and `get_driver_participation_history(db, *, trip_id: UUID, driver_id: UUID) -> DriverParticipationHistoryRead`.

- [ ] Write endpoint tests for success, missing/invalid authentication using existing auth semantics, wrong role/org/resource, 422 fields, each endpoint/status/code combination in the contract, ordinary-dispatcher identity denial, and actor-bound retries. A driver confirmation saved with blocked completion returns 200/pending; dispatcher completion returns 409; a non-admin identity-attestation attempt returns 403. Do not conflate these cases. Assert DB changes, stored evidence and no extra events after replay.
- [ ] Register new driver literal routes before existing trip parameter routes. Generate OpenAPI from the app and test unique route operation IDs and response schemas. Test `/trips/me/substitution-notices` is not parsed as a UUID trip ID.
- [ ] Add derived-current driver and completed/pending substitution fields to dispatcher reads; add `driver_access` only on authorised current-driver reads. List former drivers' participation without marking the entire trip terminal. The separate history endpoint redacts subsequent live locations, unrelated evidence and PII.
- [ ] Keep notices in the same transaction as lifecycle events; a reconnect fetch recovers a missed realtime event. Emit a thin org-scoped realtime kind for dispatcher refetches. Mark-read is not a driver confirmation and never transfers custody. Use the C0R transaction-aware hook and verify savepoint release emits nothing before the outer commit, including when the event was queued before that savepoint.
- [ ] Include every participant in fleet driver detail and trip history. Current-driver search uses the derivation; original-driver integrity and historical participation use explicit original/participant queries. Review remaining `Trip.driver_id` uses against this distinction.
- [ ] Enforce `DRIVER_SUBSTITUTIONS_ENABLED` on new arrangements and replacements, after exact-success replay handling. Expose the flag on dispatcher detail. Test disabled-mode 503 with no new row, while existing confirmation/completion/cancellation, correction, history, late-evidence and anchor recovery still operate.
- [ ] Run `cd backend && pytest tests/integration/test_driver_substitution_endpoints.py tests/integration/test_driver_substitution_reads.py tests/integration/test_driver_substitution_notices.py tests/integration/test_trips_driver_active.py tests/integration/test_trips_driver_list.py -q`; compare the actual OpenAPI types and fixtures with Tim before connecting his client.

**Done:** Tim has working, tested endpoints and role-safe data; both drivers discover arrangements without an active-trip dependency.

## C7 Build dispatcher controls and complete audit and reporting

**Owner:** Ciaran. **Depends on:** C6. **Fence:** no driver-app changes; no unrelated redesign of trip detail or analytics.

**Files:** create the three dispatcher components and API wrapper listed in the structure section, each with matching tests; modify `components/trips/{DriverModal,TripSummary,TripTimeline,TripInformation}.tsx`, `app/(app)/trips/[id]/page.tsx`, `lib/phase/trip-detail.ts`, `lib/realtime/{types,ranking}.ts` and `lib/realtime/RealtimeProvider.tsx`. Backend changes: `orchestration/audit_packs/{builder,analysis}.py`, `reporting/pdf_renderer.py`, `reporting/templates/audit_pack.html.j2`, `schemas/audit_pack.py`, `analytics/{driver_metrics,views}.py`, `analytics/fleet/base.py`, `orchestration/exceptions/queries.py`, and Ciaran-named migration(s) updating the existing driver analytics SQL view. Also modify `backend/app/dev/endpoints/triggers.py` and `backend/app/dev/schemas.py` only for derived-current-driver selection, labels and actor context; extend the existing dev-trigger tests. Tests: `test_driver_substitution_audit.py`, `test_driver_substitution_analytics.py`, existing audit/analytics tests and component tests.

- [ ] Write failing UI tests for arrange, eligibility errors, exchange pin/time/instructions, pending confirmations, cancel/replace, same-org dispatcher attestation, truthful unavailable identity and history. Include an old version returned after another dispatcher acted.
- [ ] Add Driver and handover controls to existing trip detail and the driver modal entry. Gate new-arrangement controls on the server flag and retain form data on `SUBSTITUTIONS_DISABLED`. Reuse existing availability UI/API; render planned point separately from timestamped latest vehicle position. Show completion mode, missing confirmations and anchor debt separately. Add restricted late-evidence acknowledgement and an Add clarification action for a completed transfer; clarify that it cannot change current driver.
- [ ] Keep the timeline's phase plan unchanged. Render custody events chronologically with their phase context when available and in the trip-record section otherwise. Show cancellations/replacements without pretending custody transferred.
- [ ] Extend audit schema and builder to include custody periods, separate declarations, attestations, evidence hashes, late-evidence status and anchor receipts. Existing readers already load completed substitutions; extend them rather than duplicate a second crew model. Preserve already issued audit-pack snapshots. Order custody by sequence in `_load_crew`, not `substitution_at`; use the C1 legacy policy rather than guessing tied chronology. Label the original trip-level `idvs_check_status` as the original-trip identity snapshot; show each later custody period's own verification/attestation and licence eligibility separately. Never imply the original driver's result verifies every replacement. Distinguish arranger, each confirmer, completion actor and identity-attesting admin.
- [ ] Update driver metrics at their source: `driver_metrics.py` reads `DriverAnalyticsView`; replacing a Python grouping alone will not repair the underlying SQL view. Add a new migration; do not edit Tom's deployed migration. Attribute driver-raised events by actor, phase dwell only within a known actor's custody period, and label/exclude cross-handover whole-trip metrics from individual-driver rankings when they cannot fairly be split. Fleet whole-trip totals must not double-count a multi-driver trip. Preserve baseline no-substitution metric behaviour; do not relabel unknown legacy actors as verified captures.
- [ ] Update dev triggers to resolve current custody before constructing driver-authenticated actions; use the actual current driver and sequence rather than original `Trip.driver_id`. Keep seed/original-lock paths unchanged. Test a post-transfer trigger acts as B, and its displayed driver name is B.
- [ ] Add audit sequence-versus-timestamp-order, original-versus-replacement identity labels, unknown legacy completion actor, and A→B→C→A reporting tests, null legacy actors, cross-boundary dwell, current-driver search and post-transfer exception attribution. Update `DriverAnalyticsSummary.tsx` and relevant labels/tests to expose excluded/shared-trip metric scope instead of silently blaming A.
- [ ] Run focused backend audit/analytics tests and `cd frontend/dispatcher && npm test -- components/trips/DriverSubstitutionPanel.test.tsx components/trips/DriverSubstitutionDialog.test.tsx components/trips/LateDriverEvidencePanel.test.tsx`; then dispatcher type-check, lint and build. Test each new component and the existing trip detail, timeline and realtime consumers.

**Done:** dispatchers can manage the feature and inspect the full evidence chain; exports and metrics preserve attribution.

## C8 Integrate with Tim and prove the release

**Owner:** Ciaran for backend/dispatcher; Tim for driver app. **Depends on:** C7 and T1–T4. **Fence:** no partial live rollout and no destructive schema fallback after completed transfers exist.

**Files:** add `backend/tests/integration/test_driver_substitution_e2e.py`; extend existing component/integration tests owned by each developer. Update `docs/known-issues.md` section 9b, `docs/db-models.md`, `backend/docs/api_contract_dispatcher_driver.md` and this plan's task status. Do not rewrite the original team-decision spec.

- [ ] On isolated test data, demonstrate: dispatcher arranges A→B, both see notices and the precise exchange point, A and B confirm independently, B continues at the same phase, A becomes read-only history, crew availability updates and the chain verifies.
- [ ] Demonstrate missing-confirmation completion by an ordinary dispatcher; show that the same account cannot override unavailable identity. Repeat with admin attestation; FAILED identity remains visibly failed and cannot complete.
- [ ] Demonstrate cancellation/replacement, trip termination while pending, multiple swaps, a driver returning, simultaneous submissions, stale UI versions, no current trip for B, and no signal during A's last capture. Verify late evidence remains attributed and does not complete B's phase.
- [ ] Show that a Hedera or broker failure produces visible retryable debt, then recover without a duplicate transfer. Change a test copy of an artifact/source field and prove integrity failure. Do not alter real evidence.
- [ ] Run `cd backend && pytest`. Integration tests must execute on isolated PostgreSQL; skipped DB tests are not a pass. In each frontend run `npm test`, `npm run type-check`, `npm run lint`, `npm run build`. Tim supplies native/export evidence from his handoff. Do not run a dependency upgrade to hide failures.
- [ ] Verify a clean migration path against an isolated copy of the current schema, startup task registration and baseline trips without substitutions. Human developers coordinate integration and apply the merged migration from `dev`; agents do not perform Git integration or shared DB upgrades.
- [ ] Keep `DRIVER_SUBSTITUTIONS_ENABLED=false` until the backend and Tim's compatible client are released together. Enable only after the combined tests pass. Demonstrate disabling it again after a real test transfer: new arrangements stop while existing pending work, completed-chain resolution, authorisation, late-evidence retention and verification remain active. Do not downgrade away recorded custody.
- [ ] Record exact test results, any pre-existing failures, demonstrated clients, known limitations, migration names and shared-file changes. Record background push as outside v1, the actual verified-record provenance/admin-only limitation, and whether the team-confirmed integration cut-off was met.

**Done:** all spec acceptance scenarios are mapped to passing evidence, and both owners sign off on the actual combined flow.

## Risks and tripwires

| Risk | Early tripwire | Response |
|---|---|---|
| Concurrent ownership or reservation | C2 independent-session test hangs or double-assigns | Fix lock order and shared query before lifecycle routes are exposed |
| Driver queue loses evidence | T3 sees an unrecognised 409 disappear or a capture reassigned to B | Retain needs-attention and use C4 late-evidence receipts; block release |
| Legacy data or payload incompatibility | C1 migration finds ambiguous old substitutions; C5 old receipt fails | Stop that migration/anchor change and define reviewed compatibility handling; never fabricate history |
| Unexpected identity/push scope | No genuine VERIFIED population path or no sending provider | Use truthful PENDING/admin attestation and in-app refresh; no new identity workflow or background-push acceptance within v1 |
| Deadline pressure | Combined flow cannot pass by the C0-recorded integration cut-off | Keep new arrangements disabled; retain recorded custody and do not weaken release protections |
| SQL metrics still blame original driver | C7 A/B fixture counts B's event against A | Fix the SQL view migration and labels; do not rely on a Python-only patch |

## Named regression cases

Use these names in the owning task's new test file; assertions below are the minimum required behaviour, not implementation-mirroring tests.

| Task | Test | Required assertions |
|---|---|---|
| C0R | `test_savepoint_release_never_publishes_before_outer_commit` | Events queued before and inside a savepoint wait for outer commit; outer rollback publishes nothing |
| C0R | `test_nested_rollback_preserves_only_parent_outbox` | Failed nested-scope events are discarded, earlier parent events publish exactly once on outer commit |
| C1 | `test_ambiguous_legacy_chain_blocks_migration` | Ambiguous chronology stops the isolated migration without fabricated requests/actors or damaged FKs |
| C1 | `test_returning_driver_has_a_new_custody_sequence` | A→B→C→A yields driver A, sequence 3 and the third completed substitution ID; trip's original ID and driver remain unchanged |
| C2 | `test_stale_actor_is_rechecked_after_trip_lock` | A request queued behind handover cannot write as A after B takes over; no phase or receipt is inserted |
| C2 | `test_old_capture_is_not_current_after_driver_returns` | A's sequence-0 payload is refused in A's later sequence with `CUSTODY_CONTEXT_CHANGED`; no action is relabelled |
| C2 | `test_former_driver_exact_replay_has_no_current_trip_data` | Matching actor/key is acknowledged by opaque reference; unrelated actor or changed key cannot obtain that acknowledgement or current detail |
| C2 | `test_anchor_worker_receipt_insert_does_not_deadlock_handover` | Real independent sessions and FK inserts terminate within a bounded timeout with one transfer and intact receipt |
| C3 | `test_licence_eligibility_uses_actual_sast_completion_date` | Null/expired dates refuse; expiry on the SAST date is valid; crossing midnight rechecks and retains saved captures |
| C3 | `test_failed_identity_cannot_be_admin_attested` | FAILED remains failed, even for admin; no new custody row or false VERIFIED result |
| C3 | `test_dispatcher_missing_capture_does_not_override_pending_identity` | Ordinary dispatcher is allowed missing-capture attestation but denied PENDING-identity override; admin may record an unavailable-identity attestation without changing status to VERIFIED |
| C3 | `test_terminal_trip_cancels_pending_request_atomically` | Pending state, reservation release and two notices change together; failed transaction changes none |
| C4 | `test_late_capture_receipt_does_not_advance_phase` | Capture bytes/actor/times and review receipt persist; current phase, current driver and completed-chain length do not change |
| C5 | `test_old_receipts_verify_after_v4_actor_commitments` | Legacy phase v1/v2/v3 and evidence v1 verify; edited actor or stored photo on a new event fails verification |
| C6 | `test_notice_route_is_not_parsed_as_trip_uuid` | Literal notice URL returns the actor's notices, never a UUID validation error or another actor's notice |
| C7 | `test_audit_crew_uses_sequence_and_period_identity` | Sequence beats tied/contradictory timestamps, original identity is clearly scoped and replacement attestation stays distinct |
| C7 | `test_dev_trigger_uses_current_driver_after_transfer` | Driver label and submitted actor/sequence resolve B after A→B, without altering original-lock fields |
| C7 | `test_later_driver_events_are_not_counted_against_original_driver` | B's event counts against B, cross-custody dwell is excluded or labelled shared, and a multi-driver trip counts once in fleet totals |

The unit test for custody derivation must make the invariant concrete: `assert result.driver_id == original_driver_id`, `assert result.sequence == 3`, `assert result.substitution_id == third_link.id` after the supplied A→B→C→A links. These assertions do not permit timestamp-based reordering or mutation of source records.

## Completion checklist and next session

- [ ] C0 contract/types/fixtures reviewed with Tim; identity provenance and actual release cut-off recorded
- [x] C0R transaction-boundary event regression passes
- [ ] C1 schema and migration verified
- [ ] C2 access and availability verified
- [ ] C3 lifecycle verified
- [ ] C4 capture and late evidence verified
- [ ] C5 anchoring and immutable attribution verified
- [ ] C6 HTTP reads/notices contract verified with Tim
- [ ] C7 dispatcher/audit/reporting verified
- [ ] Tim T1–T4 complete
- [ ] C8 combined acceptance and release evidence complete

Start a fresh implementation session with: “Read CLAUDE.md, the FP-83 spec, this plan and the v1 contract. Implement C0 only, respecting Ciaran/Tim ownership. Do not edit the driver app, run Git write operations, read secrets or apply migrations to shared Supabase. Report the exact checks and the contract handoff before moving on.”
