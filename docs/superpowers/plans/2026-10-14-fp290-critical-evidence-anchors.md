# FP-290: Critical evidence anchors — implementation plan

> Planned 14 Oct 2026 on `Ciaran` (HEAD `af2317c`, `origin/dev` `c1ca1cd`). Not implemented.
> **Implementer:** read `CLAUDE.md` first. Execute tasks in order with `superpowers:executing-plans`. Each task: write the named failing tests → implement → rerun. No commits, pushes, branch ops, or `alembic upgrade` on shared Supabase. Never read `.env`.

**Goal:** a critical incident with multiple photos gets one Hedera receipt covering the record and every photo's bytes; its cancellation and each review get their own receipts. A Hedera outage never loses evidence; it leaves retryable anchor debt.

**Layering:** endpoints → orchestration → blockchain/crypto → db. Write source rows + event + frozen hash in one transaction; dispatch the event ID after the outer commit; the worker anchors only the frozen hash; the verifier rebuilds from live source rows.

## 1. Decisions (fixed — do not re-decide)

| Topic | Decision |
|---|---|
| Identity | One `EvidenceAnchorEvent` row per action (raise / review / cancel). `SubjectType.EVIDENCE_EVENT = "evidence_event"`, `subject_id = event.id` (never trip/exception ID). |
| What gets anchored | Raise: persisted `severity == critical`, any source. Review: **every new actual review** (single, batch member, dispatcher-authored note/override/cancellation). Claims/releases: never. Cancel: explicitly from `cancel_trip`. |
| Photos | 0–5 per report (`MAX_EXCEPTION_PHOTOS = 5`), existing 10 MiB/file limit. Membership frozen at creation; no post-submit edits. |
| Cargo | No journey-lock v3. Document that the PP snapshot hash commits the creation-time manifest. v1/v2 payload bytes unchanged. |
| GPS | Never hashed. Exclude `gps_*`, location assessments, artifact coordinates, location trails. GPS-only edits must not break a receipt. |
| Historical rows | No backfill, no fabricated events. Old exceptions show "recorded", not "pending". Legacy single-photo rows stay readable. |
| Demo | No collision enum exists. Demo a **broken-seal** critical incident (or add the collision type first, if the separate catalogue lands). Don't call a seal incident a collision. |
| Out of scope | Severity-policy engine/fingerprints, escalation, Merkle batching, ping/checkpoint anchoring, sign-off, driver substitution, portable verifier, cancellation-reason catalogue, photo amendments, phase-sequence changes. |

## 2. Facts from the codebase (verified 14 Oct)

- `blockchain/anchor_service.py`: `canonicalize_payload` → `compute_payload_hash` (SHA-256) → `submit_hash`. HCS receives the digest only.
- `SubjectType`/`BlockchainReceiptType` are `String(30)` columns → new enum members need no DDL.
- `TripException` (`db/models/transit.py`): no anchor fields; single `supporting_artifact_id`; immutable first-review fields `reviewed_by_user_id`/`reviewed_at`/outcome.
- `exceptions/creation.py`: idempotency on `(trip_id, client_report_id)` with savepoint on race. Critical driver types today: panic, broken seal, seal mismatch.
- `exceptions/review.py`: first review wins under row lock; same-reviewer replay = no-op; other reviewer = 409; batch refuses critical rows.
- `trips/administration.py`: cancel locks Trip, sets `cancelled`/`closed_at`, creates a warning `DISPATCHER_NOTE` (description prefixed `Cancelled by user <uuid>: `) with reviewer fields set. Re-cancel = 409.
- Phase pipeline to **copy, not refactor**: `phases/anchor_dispatch.py` (after_commit + local fallback), `anchor_execution.py`, `anchor_recovery.py` (`SKIP LOCKED`, rotates `updated_at`), `tasks/blockchain.py` (3 retries × 30 s; Beat sweep 60 s, age 300 s, batch 20).
- **Known trap:** a `begin_nested()` savepoint release fires `after_commit` (see memory "savepoint release publishes outbox"). Dispatch must bind to the outer transaction.
- `TripException(` constructed in: `exceptions/creation.py`, `phases/findings.py`, `advance_departure.py`, `advance_confirmation.py`, `phases/override.py`, `consignments/scans.py`, `evidence/action_location.py`, `evidence/road_check.py`, `handover/receiver_verification.py`, `trips/administration.py`. (`advance_loading.py` only notifies — don't double-record.)
- `trips/detail.py` only selects TRIP/PHASE_EVENT receipts; `exceptions/queries.py` has its own projection — both need extending.
- `verification/service.py` picks a subject's latest receipt; has reconstruction + visibility registries with exhaustiveness tests.
- Audit pack (`audit_packs/builder.py`) hardcodes exception/photo tiers to "recorded"; filters exceptions by consignment.
- Driver: `LogExceptionPageClient.tsx`, `TripContext.tsx`, `lib/api/exceptions.ts`, `useOfflineQueue.ts` assume one photo; the queue stores data URLs in localStorage and drops the photo on quota failure.
- Migration head: `ciaran_artifact_attribution`. CI applies the chain to a disposable DB. Autogenerate emits destructive drift → **hand-write** the migration.

## 3. Contracts

### 3.1 Tables (`backend/app/db/models/evidence_anchors.py`, register in `db/models/__init__.py`)

- **`exception_artifacts`**: `id` UUID PK, `exception_id` FK, `artifact_id` FK, `position` int, timestamps. Unique `(exception_id, artifact_id)` and `(exception_id, position)`. No cascade delete. Keep `supporting_artifact_id` = first photo for new rows.
- **`evidence_anchor_events`**: `id` UUID PK, `trip_id` FK, `exception_id` FK, `receipt_type` (`exception_raised|exception_reviewed|trip_cancelled`), `occurred_at` timestamptz, `payload_version` int, `payload_json` (immutable), `event_hash` (immutable), `anchor_status` (`pending|failed|anchored`), `receipt_id` nullable FK, timestamps. Unique `(exception_id, receipt_type)`. Indexes on `(anchor_status, updated_at)`, `trip_id`, `exception_id`. Check constraint: `anchored` ⇔ `receipt_id IS NOT NULL`.
- New `BlockchainReceiptType`: `EXCEPTION_RAISED`, `EXCEPTION_REVIEWED`, `TRIP_CANCELLED`. Receipt `trip_id` always set.
- Migration `backend/migrations/versions/2026_10_14_ciaran_evidence_anchors.py`: two tables, RLS on, Supabase API-role revokes (role-existence-safe pattern used elsewhere). Every `op.*` line must be intended.

### 3.2 API (report body in `schemas/transit.py`)

- Add `supporting_artifact_ids: list[UUID] | None` (max 5, no duplicates → 422). Keep `supporting_artifact_id`. Only old field → list of one. Both → old must equal list[0], else 422. `[]` + non-null old → 422.
- Validate every artifact belongs to the trip before any write; missing/foreign → 404.
- Replay with the same `client_report_id` returns the original exception, photos, and event IDs, even if the body differs.
- Read schemas: add `supporting_artifacts` (no storage keys) and `anchor_events: list[EvidenceAnchorSummary] = []` (`event_id`, `receipt_type`, `anchor_status`, `receipt_id | None`, `occurred_at`).

### 3.3 Payload v1 (`orchestration/evidence_anchors/canonical.py`, pure functions over typed value records, not ORM objects)

Timestamps → UTC ISO-8601. Text hashed as UTF-8, no trimming/normalisation; `null` ≠ `""`. `actor_sha256(user_id) = compute_payload_hash({"actor_type": "user", "user_id": str(user_id)})`.

Common keys: `payload_version: 1`, `event_type`, `event_id`, `trip_id`, `exception_id`, `occurred_at`.

- **Exception record** (shared builder, defined once): `payload_version`, `trip_id`, `exception_id`, `occurred_at=created_at`, `exception_type`, `source`, `severity`, `description_sha256`, `context_sha256` (hash of `{phase_event_id, checkpoint_id, consignment_id, trip_stop_id, vehicle_id}` as str/null), `photos` (`[{artifact_id, sha256}]` sorted by artifact_id; `[]` explicit).
- **`exception_raised`**: common keys + exception record fields.
- **`exception_reviewed`**: common + `exception_record_sha256` (hash of the exception record, built even for non-critical rows), `reviewed_by_sha256`, `review_outcome`, `contact_method`, `review_note_sha256`, `authored_statement_sha256` (hash of `description` for dispatcher-authored rows, else null). `occurred_at = reviewed_at`.
- **`trip_cancelled`**: common + `status: "cancelled"`, `cancelled_by_sha256` (from the note's reviewer fields), `cause_record_sha256` (hash of the exact persisted note description, prefix included). `occurred_at = trip.closed_at`.
- Never include: coordinates, raw text, names, emails, phones, ID/licence numbers, file paths, URLs, bytes, model dumps.
- Version check: must be int `1` exactly; missing/bool/str/other → verification `error`. Event kind and receipt type must match.

### 3.4 Failure and retry

- Request: source + memberships + event + hash in one transaction; dispatch after the **outer** commit; local fallback if the broker fails. Rollback → nothing published.
- Worker: lock event row. Already linked → validate receipt, return. Else check version/kind, rebuild from source, require hash == `event_hash`, then `anchor_subject` and link the receipt.
- Hedera error → commit `failed`; never roll back the source. Infra/DB errors → roll back the attempt and retry. Log IDs and error classes only.
- Recovery: pending + failed (incl. exhausted), `FOR UPDATE SKIP LOCKED`, rotate `updated_at`, same constants as phases. Always compare against the original `event_hash`; never re-baseline edited evidence.
- No exactly-once claim: a crash after Hedera accepts but before commit can duplicate an HCS message. The event row is the application identity; one linked receipt only.

### 3.5 Verification and visibility

- Visibility: event → exception → `trip.operator_organization_id`, with `event.trip_id == exception.trip_id`. Unknown/foreign → 404 before any storage/Hedera call. Register in both registries and their exhaustiveness tests.
- Reconstruct from live source rows (not `payload_json`); compare to both `event_hash` and the receipt hash. Rehash every photo with `hash_stored_evidence_file`. Changed/missing data or bytes → mismatch; storage/mirror down → error.
- Add optional exact `receipt_id` selection to the shared verifier (default stays latest). Audit-pack live checks pass the frozen manifest's `receipt_id`.

## 4. Files

**Create**
- `backend/app/db/models/evidence_anchors.py`, the migration above
- `backend/app/orchestration/evidence_anchors/`: `canonical.py`, `recording.py`, `artifacts.py`, `dispatch.py`, `execution.py`, `recovery.py`, `reads.py`
- `backend/app/orchestration/verification/evidence_payloads.py`
- `backend/app/tasks/evidence_anchors.py`
- `frontend/driver-pwa/lib/offline/exception-store.ts` (native IndexedDB)
- `frontend/shared/lib/constants/exception-evidence.ts` (`MAX_EXCEPTION_PHOTOS`, mirrored by a backend contract test)
- `frontend/dispatcher/components/exceptions/ExceptionAnchors.tsx`
- `docs/design-notes/2026-10-14-fp290-evidence-commitments.md`

**Modify:** `db/models/__init__.py`*, `enums.py`*, `core/constants.py`, `schemas/transit.py`, `api/v1/endpoints/exceptions.py` (pass-through only), `exceptions/creation.py`, `review.py`, `queries.py`, `trips/administration.py`, `trips/detail.py`, all creation sites in §2, `blockchain/subject_visibility.py`, `verification/service.py`, `verification/errors.py`, `tasks/__init__.py`*, `audit_packs/builder.py`, `access.py`, `schemas/audit_pack.py`, report templates, shared TS types*, driver exception API/page/`TripContext`/offline hook/`OfflineBanner`, dispatcher exception detail + trip exception panel, portal types/`EventDetail`/`Sections.tsx`.

`*` = shared file → flag in TASK COMPLETE. Driver files overlap with **Tim's redesign** → confirm with the user before editing them.

**Interfaces**
```python
load_exception_artifacts(db, *, exception: TripException) -> list[EvidenceArtifact]
prepare_exception_anchors(db, *, exception: TripException, cancelled_trip: Trip | None = None) -> list[EvidenceAnchorEvent]  # no Hedera, no commit
dispatch_evidence_anchor(db, *, event_id: UUID) -> None
anchor_evidence_event(db, *, event_id: UUID) -> bool          # caller owns the transaction
recover_evidence_anchor(db, *, due_before: datetime) -> bool | None
reconstruct_evidence_event(db, *, event_id: UUID, anchored_payload: object) -> EvidencePayloadState
# EvidencePayloadState: frozen dataclass(payload: dict[str, Any], artifacts: tuple[EvidenceArtifactCommitment, ...])
# Celery tasks: tasks.evidence_anchors.anchor_event, tasks.evidence_anchors.recover_events (event IDs only)
```

## 5. Tasks

### Task 0 — Preflight
- [x] Done 14 Oct: fetch clean, no migrations on `origin/dev` beyond HEAD, single head `ciaran_artifact_attribution` (Tim-files question skipped — Task 4 only).
- `git fetch origin`; `git diff --name-status HEAD...origin/dev -- backend/migrations/versions`; confirm one head = `ciaran_artifact_attribution`. Different head → stop and ask.
- Ask the user whether Tim's driver files are clear to edit (Task 4).

### Task 1 — Critical report + multiple photos → verifiable receipt
- [x] Verify command green 14 Oct (tests listed below + registry/lockdown-coverage/receipt-lookup/OpenAPI-snapshot/dev-reset regressions).
Build: models, migration, enums, `canonical.py`, `artifacts.py`, `recording.py`, `execution.py`, `evidence_payloads.py`, visibility/registries, creation schema/endpoint.

Tests:
- `tests/unit/test_evidence_anchor_payloads.py`: golden hashes (incl. non-ASCII), UTC normalisation, photo order independence, null vs `""`, exact key allowlist, actor digest, GPS/text never read, bad versions rejected.
- `tests/integration/test_critical_exception_anchors.py`: 2-photo success; legacy singular body; conflicting fields → 422; 6 photos / duplicates → 422; foreign/missing artifact → 404 with zero writes; idempotent replay + race → original membership/event; warning report → no event.
- `test_blockchain_verify.py` (or new file): both photos' bytes checked; edited description/severity/context/member/file → mismatch; GPS-only edit still verifies; storage outage → error; cross-org → 404 before storage/Hedera.
- `test_data_api_lockdown.py`: both new tables locked down.

Run: `cd backend && .venv/bin/pytest -q <files above>`. Integration cases must execute, not skip.

### Task 2 — Dispatch and recovery
- [x] Verify command green 14 Oct (listed files + full suite).
Build: `dispatch.py`, `recovery.py`, `tasks/evidence_anchors.py`, Beat registration. Leave the phase task path untouched.

Tests:
- `tests/unit/test_evidence_anchor_tasks.py`: task/Beat registration, retry/sweep constants, retry on False/infra error, engine disposal.
- `tests/integration/test_evidence_anchor_recovery.py`: outer commit publishes once; rollback publishes nothing; **nested savepoint release does not publish early**; broker failure → fallback; never-dispatched event recovered; exhausted retries still eligible; `updated_at` rotation; failed state persists in a separately committed transaction.
- `tests/integration/test_evidence_anchor_concurrency.py` (separate connections): two workers/sweeps → one linked receipt; corrupted queue / wrong receipt kind / changed source never replaces the original hash.

Run: those plus `tests/unit/test_blockchain_task_registration.py tests/integration/test_every_phase_anchoring.py`.

### Task 3 — Cancellations and reviews
- [x] Verify command green 14 Oct (listed files + full suite).
Build: hooks in `review.py` (single + batch), `cancel_trip`, `phases/override.py`, and every creation site in §2. Bind and flush note objects so events reference real rows. Don't infer cancellations from `DISPATCHER_NOTE` prefixes.

Tests:
- `tests/integration/test_exception_decision_anchors.py`: single review; batch (one event per newly reviewed row); mixed batch with already-reviewed rows; same-reviewer replay and conflicts → no new event; all-or-nothing.
- Extend `test_trip_admin.py`, `test_trip_cancel_concurrency.py`: cancel commits status/cause/actor/time; re-cancel 409; phases unchanged; phase race can't undo cancel; Hedera outage loses nothing. Cancel produces distinct `trip_cancelled` and authored `exception_reviewed` events.
- Parameterised workflow matrix over every creation site: critical → raise event; warning/info → none; authored-reviewed → review event.

Run: those plus `test_exception_batch_review.py test_exception_review_concurrency.py` and the touched workflows' existing tests.

### Task 4 — Driver multi-photo capture + durable offline queue
Build:
- Up to 5 photo drafts per report (`CameraCapture` reused), each with a local ID, capture time and optional uploaded artifact ID. One `client_report_id` per draft, kept through retries, queueing and reload.
- `exception-store.ts`: one IndexedDB envelope per report (body + photo blobs + per-photo upload results). Persist each artifact ID before the next upload; keep bytes until the POST is acknowledged. Phase/checkpoint/location queues keep their current storage.
- Migrate legacy localStorage exception entries (`photoDataUrl`/`photoCapturedAt`): write the envelope, then delete the old entry; dedupe by ID; resume an already-uploaded `supporting_artifact_id` without re-upload. Enqueue is async; await it before showing "saved".
- Transient failure → keep everything. Permanent rejection → visible "needs attention" envelope; other reports continue. Never send a reduced photo set silently. Quota/permission failure → keep the form open and say what wasn't saved. POST sends the complete ID list only. The panic flow still works without photos; nothing waits on Hedera. No new dependencies; no 409 auto-discard.

Tests: extend `LogExceptionPageClient.test.tsx`, `useOfflineQueue.test.ts`, `TripContext.real.test.tsx`; add `lib/offline/exception-store.test.ts`. Cover: two photos reach the API; restart after first upload; lost POST response; same report ID; legacy migration; blocked storage; partial/permanent upload failure; panic/phase/checkpoint/location regressions.

Run (in `frontend/driver-pwa`, Node 22): those tests, `npm run type-check`, `npm run build`.

### Task 5 — Dispatcher, audit pack, portal
- [x] Verify green 15 Oct: backend files below + full suite (3179 passed, 4 skipped); dispatcher and client-portal `npm test`, `type-check`, `lint`, `build`. Manifest v2; `test_audit_pack_pdf.py` lives under `tests/unit/`.
- [x] `reads.py` batched anchors + photos (exception detail, trip detail, mutation responses)
- [x] `trips/detail.py` evidence_event receipts
- [x] Dispatcher is review-only (decided 15 Oct): every photo on exception detail and the trip panel; no anchor status, retry text or verify buttons there (`ExceptionAnchors.tsx` was built, then removed). `anchor_events` stays in the API but has no dispatcher reader. Anchor state, hashes and receipts live in the audit pack and shared portal.
- [x] Audit pack manifest v2, tiers, scope, exact receipts, added-since-issue
- [x] Portal `Sections.tsx`/`EventDetail` + both PDF templates
Build:
- `reads.py`: batched `anchor_events` for exception detail, trip detail and mutation responses (pending shows immediately; historical rows show no events).
- `trips/detail.py`: include `evidence_event` receipts with existing tenant joins.
- `ExceptionAnchors.tsx`: per-action status + `VerifyButton` on `evidence_event`; used in exception detail and the trip exception panel. Non-admins keep summary-only access.
- Audit pack: manifest **v2** adds photo collections and per-action anchor summaries (v1 manifests stay valid and unmodified; seal version unchanged). Tier = anchored only when the matching event is anchored and hashes match; a review receipt never promotes the raise tier; GPS stays "recorded". Scope events and photos to in-scope consignments (trip-level cancellation appears everywhere). Live checks use exact receipt IDs. "Records added since issue" counts new events (incl. reviews of old exceptions), deduplicated.
- Portal `Sections.tsx`/`EventDetail` + PDF templates: replace the hardcoded "recorded" badge; render every photo via existing authorised endpoints; tie each photo hash to its receipt member. No TS canonicaliser.

Tests: extend `test_exception_reads.py`, `test_blockchain_receipt_lookup.py`, `test_audit_pack_builder.py`, `test_audit_pack_public.py`, `test_audit_pack_pdf.py`; component tests for `ExceptionAnchors`, exception photos, portal details. Cover: two photos; mixed statuses; source tamper; scoped-out receipts; v1 pack compatibility; post-issue review; exact receipt selection.

Run: those backend tests; `npm test`, `npm run type-check`, `npm run build` in `dispatcher` and `client-portal`.

### Task 6 — End-to-end proof and docs
- [x] Done 15 Oct: `test_fp290_incident_chain.py` (8 tests), design note, two cargo tests in `test_trip_verification.py`; backend gate run 15 Oct: pytest 3201 passed / 4 skipped, ruff, mypy app and lint-imports clean; `check_structure.py` fails only on files FP-290 did not touch (see report). Manual items below are still the user's.
- `tests/integration/test_fp290_incident_chain.py`: critical broken-seal report with 2 photos → cancel → review; distinct events/receipts; all photo bytes verified; Hedera failure → `failed` → recovery; a newly issued, scoped audit pack has the exact receipts and all photos (pending/failed shown honestly before recovery). Receipts and coverage are inspected in the audit pack and the shared portal, not the dispatcher (which is review-only, see Task 5).
- Design note: coverage matrix per field, GPS never-hashed, PP snapshot = creation-time manifest (non-PP legs have no cargo commitment), capture time vs server time vs consensus time, retry runbook. Add cargo tests to `test_b3_canonical_hashes.py` / `test_trip_verification.py` / `test_trips_anchor.py` only where missing.
- Full backend gate from `backend/`: `.venv/bin/pytest`, `.venv/bin/ruff check .`, `.venv/bin/mypy .`, `.venv/bin/lint-imports`, `.venv/bin/python scripts/check_structure.py`. Run pytest in the foreground (a concurrent run wipes the test DB).
- Manual (user): offline/reload two-photo flow on browser + Android; rendered PDF and portal at phone/desktop widths.
- Finish with CLAUDE.md TASK COMPLETE: migration name, shared files touched, no new env/deps.

## 6. Acceptance

Backend rows were observed passing in the full-suite run of 15 Oct (3201 passed, 4 skipped). Names are `file::test`.

| Requirement | Proof |
|---|---|
| Critical incident + multiple photos anchored | T1 `test_critical_exception_anchors::test_critical_report_with_two_photos_freezes_one_pending_event`, `::test_worker_entry_point_anchors_the_frozen_hash_and_links_the_receipt`. T6 `test_fp290_incident_chain::test_new_pack_after_recovery_has_exactly_the_right_receipts_and_both_photos`. T4 `exception-store.test.ts` (envelope with ordered photo blobs): frontend suite **not re-run in T6**; two-photo reload on a device is manual |
| Cancellation with cause, actor, time | T3 `test_trip_admin::test_cancel_freezes_distinct_cancellation_and_authored_review_events` (cause digest, actor digest, `occurred_at == trip.closed_at`). T6 `test_each_action_has_its_own_event_and_receipts_stay_separate` |
| Review who/when/outcome, incl. batch + authored | T3 `test_exception_decision_anchors::test_single_review_freezes_one_review_event`, `::test_batch_creates_one_event_per_newly_reviewed_row`, `::test_mixed_batch_skips_rows_this_user_already_reviewed`; authored: the cancellation-note review in the T3 cancel test above |
| No GPS/text/identity in payloads | T1 `test_evidence_anchor_payloads::test_payloads_carry_exactly_the_allowlisted_keys`, `::test_record_types_have_no_gps_or_location_fields`, `::test_payload_contains_no_raw_text_or_identity_values`; `test_evidence_anchor_verify::test_gps_only_edit_still_verifies` |
| Hedera/broker failure leaves recoverable debt | T2 `test_evidence_anchor_recovery::test_broker_failure_falls_back_to_a_local_anchor`, `::test_never_dispatched_event_is_recovered_and_anchored`, `::test_failed_event_with_exhausted_retries_is_still_eligible`. T6 `test_hedera_outage_leaves_failed_events_and_the_source_intact`, `::test_recovery_anchors_the_failed_events_without_touching_the_raise` |
| Tampered source/photo detected; outage ≠ mismatch | T1 `test_evidence_anchor_verify::test_edited_source_fields_are_a_db_mismatch`, `::test_replaced_file_bytes_are_a_db_mismatch`, `::test_storage_outage_is_an_error_not_a_mismatch`. T5 `test_audit_pack_evidence_anchors::test_review_receipt_never_promotes_the_raise_tier` and the receipt-reassignment tests. T6 `test_pack_issued_during_the_outage_says_failed_and_recovery_during_it_changes_nothing` (outage shown as `failed`, not as anchored) |
| No cross-tenant/cross-consignment leakage | T1 `test_evidence_anchor_verify::test_other_organisations_event_is_404_before_storage_or_hedera`. T5 `test_audit_pack_evidence_anchors::test_scoped_pack_withholds_other_consignments_events_receipts_and_photos`. T6 the new scoped pack excludes the other client's receipt while an unscoped pack includes it (same test as row 1) |
| Trip v1/v2, phase legacy/v2, manifest v1/v2 all still verify | Trip v1/v2: `test_trip_verification::test_v1_receipt_still_verifies`, `::test_multi_stop_trip_verifies`, `test_b3_canonical_hashes::test_trip_journey_lock_v2_hash_is_the_golden_sha256`. Phase: `test_phase_anchor_payload::test_departure_v1_payload_remains_byte_compatible`, `::test_confirmation_v1_payload_remains_byte_compatible`, B3 phase golden vectors. Manifest: `test_audit_pack_evidence_anchors::test_v1_manifest_json_still_validates_and_reads_as_v1`, `::test_manifest_is_version_2`. |
| Offline multi-photo survives reload; no silent photo loss | T4 `exception-store.test.ts::test_data_survives_reopening_the_connection`, `::test_quota_failure_on_put_rejects_with_quota_and_keeps_previous_record`, `legacy-exception-migration.test.ts`: **not re-run in T6; not observed on a device**. Manual check required (see the report's checklist) |
