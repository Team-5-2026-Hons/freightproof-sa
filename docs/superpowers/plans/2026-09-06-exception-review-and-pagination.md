# Exception Review and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exception resolution with a non-blocking evidence-review workflow, paginate exception and trip archives, and reuse one dispatcher pagination control.

**Architecture:** Store explicit `recorded | needs_review | reviewed` exception state and preserve the first review as immutable evidence. Keep the critical attention queue unpaginated, cursor-paginate exception history, retrieve exception detail independently, and add a separate cursor-paginated trip-history endpoint last so existing trip-list consumers do not change.

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2 async, Pydantic v2, Alembic, PostgreSQL, pytest/pytest-asyncio, Next.js 15 App Router, React 19, TypeScript 5.5+, Vitest, Testing Library, Tailwind 3.4.

**Spec:** `docs/superpowers/specs/2026-09-06-exception-review-and-pagination-design.md`

## Global Constraints

- Read `CLAUDE.md` and the linked spec before changing code; never read `.env`.
- FreightProof records evidence; reviewing never changes, blocks, resumes, or reopens a phase or trip.
- Preserve organisation scoping and return 404 for both missing and cross-organisation IDs.
- Keep realtime payloads free of PII; never log review notes.
- Use cursor pagination only; never introduce offset pagination or silent result caps.
- Default page size is 25; accepted range is 1 through 100.
- Preserve the staged concurrency, toast-priority, form-safety, and sidebar fixes already present on branch `Ciaran`.
- Treat merged FP-143/145/150 evidence as input to this feature: do not let an offline
  replay compare a historical handshake with a current tracker fix, and do not accept a
  cross-trip artifact reference or a duplicate replayed driver report.
- Only critical severity enters Needs Review. Current critical events are panic button, seal broken in transit, seal mismatch, and unexplained seal-unverified; warnings remain searchable in History.
- Warning exception toasts are ordinary auto-dismissing warning toasts; critical exception toasts remain sticky errors with critical eviction priority.
- Do not change `GET /api/v1/trips` or its array response; Trip History gets a new endpoint.
- Do not modify the driver PWA pagination UX.
- Follow TDD: observe each new test fail for the intended reason before implementation.
- Backend tests must stub Hedera, Pulsit, Supabase Storage, and other partner calls. A
  green isolated rerun after an intermittent live-service failure is not a deterministic
  suite and does not satisfy a checkpoint.
- Project policy prohibits agent commits. Stop at the review checkpoints; the developer owns commits.

---

## File Structure

New focused files:

- `backend/app/core/pagination.py`: opaque timestamp/UUID cursor encoding and validation.
- `backend/app/schemas/pagination.py`: generic `CursorPage[T]` response envelope.
- `backend/migrations/versions/2026_09_06_ciaran_corroboration_capture_time.py`: honest
  client/tracker time separation for offline-aware corroboration.
- `backend/migrations/versions/2026_09_06_ciaran_exception_idempotency.py`: replay-safe
  driver exception reports.
- `backend/migrations/versions/2026_09_06_ciaran_exception_review_semantics.py`: exception data/column migration.
- `backend/migrations/versions/2026_09_06_ciaran_trip_history_pagination.py`: terminal-trip backfill and history index.
- `frontend/dispatcher/components/ui/Pagination.tsx`: presentation-only controls.
- `frontend/dispatcher/components/ui/Pagination.test.tsx`: interaction/accessibility contract.
- `frontend/dispatcher/lib/hooks/useExceptionDetail.ts`: one-record exception read.
- `frontend/dispatcher/lib/hooks/useExceptionHistory.ts`: filtered cursor history state.
- `frontend/dispatcher/lib/hooks/useTripHistory.ts`: filtered cursor trip-history state.
- Corresponding frontend hook tests and backend integration tests named in each task.

Existing files remain responsible for their current layers; do not move business logic into endpoints or page components.

---

### Task 0A: Make merged Pulsit corroboration temporally honest

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/integrations/pulsit.py`
- Modify: `backend/app/db/models/phases.py`
- Modify: `backend/app/db/models/transit.py`
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/schemas/transit.py`
- Modify: `backend/app/orchestration/corroboration_service.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Modify: `backend/app/orchestration/checkpoint_service.py`
- Create: `backend/migrations/versions/2026_09_06_ciaran_corroboration_capture_time.py`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Modify: `frontend/driver-pwa/lib/api/checkpoints.ts`
- Modify: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts`
- Modify: phase/checkpoint submit callers and their tests identified by `rg -l "submitPhase|submitCheckpoint" frontend/driver-pwa --glob '*.ts' --glob '*.tsx'`
- Test: `backend/tests/unit/test_pulsit_client.py`
- Test: `backend/tests/unit/test_corroboration_service.py`
- Test: `backend/tests/integration/test_phase_corroboration.py`
- Test: `backend/tests/integration/test_gps_mismatch.py`

**Interfaces:**
- Adds nullable `driver_captured_at` to `PhaseEvent` and `Checkpoint`.
- Adds optional backend/required new-client capture time to phase/checkpoint requests.
- Adds `settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS`.

- [ ] **Step 1: Write failing timestamp and malformed-fix tests**

Prove an online, timestamp-aligned fix still writes coordinates/verdict; an offline replay
whose current Pulsit fix is outside the allowed skew leaves the horse coordinates and
verdict null and raises no `GPS_MISMATCH`; a missing timestamp from an older queued client
also leaves them null; trailer snapshots retain their own tracker time; naive Pulsit
timestamps and non-finite/out-of-range coordinates become `UNAVAILABLE`, never evidence.

- [ ] **Step 2: Add capture time without breaking already-queued clients**

The PWA stamps the instant the driver submits and persists it in the offline entry. The
backend field is optional for compatibility, requires timezone awareness when present,
and is stored separately from server-owned `completed_at`/`created_at`. Never substitute
request-receive time when it is absent.

- [ ] **Step 3: Gate corroboration on independent timestamps**

Pass the client capture time into corroboration. Store horse coordinates and calculate a
geofence verdict only when `abs(fix.fixed_at - driver_captured_at)` is no greater than the
named configured skew. A timing miss is null/“could not compare”, never false. Apply the
same rule to the checkpoint extension because it is also offline-queued and its horse
columns likewise carry no tracker timestamp.

Keep `PULSE_USE_MOCK=true` for execution and UI verification. Do not present the live
adapter as production-ready until the real Pulsit API contract has been checked against
its assumed path, bearer authentication, batch query, response fields, timestamp rules,
rate limits, and historical-position capability.

- [ ] **Step 4: Add the migration and update the chain**

Use revision `ciaran_corr_capture_time`, down revision
`ciaran_exc_resolution_method`. Add nullable timezone-aware columns only; do not backfill
an invented client time. Task 0B must descend from this revision.

- [ ] **Step 5: Fix the merged test lint failure**

`tests/integration/test_gps_mismatch.py` currently imports the
`corroboration_trip`/`pulsit_store` fixtures and then rebinds those names as pytest
parameters, producing 28 Ruff `F811` failures. Import only helper functions and expose
fixtures through an appropriate plugin/conftest seam, or alias the imported fixtures so
pytest can still resolve them without name redefinition. Do not suppress `F811`.

- [ ] **Step 6: Verify the prerequisite**

Run the new unit/integration cases, then `ruff check app tests`, `mypy app`, driver tests,
and driver type-check. This task is a prerequisite: do not proceed while an offline replay
can manufacture a position disagreement. If the ordinary trip integration tests still
instantiate a real `HederaService`, give them a deterministic successful adapter fixture;
keep the explicit anchoring failure tests in control of their own side effects.

**Developer review checkpoint:** inspect one deliberately delayed queued phase and confirm
that it completes normally with null corroboration and no exception.

---

### Task 0B: Make driver exception photographs and retries durable

**Files:**
- Modify: `backend/app/db/models/transit.py`
- Modify: `backend/app/schemas/transit.py`
- Modify: `backend/app/orchestration/exception_service.py`
- Create: `backend/migrations/versions/2026_09_06_ciaran_exception_idempotency.py`
- Modify: `frontend/driver-pwa/lib/api/exceptions.ts`
- Modify: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx`
- Modify: the corresponding backend integration and driver-PWA tests

**Interfaces:**
- Adds request-only `client_report_id` and nullable stored exception field of the same
  name, unique per trip when present.
- Enforces same-trip ownership for `supporting_artifact_id`.

- [ ] **Step 1: Write failing evidence-integrity tests**

Prove a missing or other-trip artifact ID is rejected without an exception/realtime write;
the same `(trip_id, client_report_id)` replay returns the original exception and emits no
second event; and a different report ID creates a distinct exception.

- [ ] **Step 2: Enforce artifact ownership in orchestration**

Before constructing `TripException`, query `EvidenceArtifact` by both artifact ID and
`trip_id`. Keep the rule in the service rather than trusting the foreign key or frontend.

- [ ] **Step 3: Add server idempotency**

Add the nullable field and a partial unique index on `(trip_id, client_report_id)`. Query
and return an existing same-trip row before inserting. Handle the unique-index race in a
savepoint/nested transaction so the session remains usable, then load and return the
winner; do not catch `IntegrityError` after poisoning the request's outer transaction.
New clients always send the stable ID; the backend accepts omission only for old
installed/queued clients.

- [ ] **Step 4: Make the queue's two-step send resumable**

Reuse the queue entry UUID as `client_report_id`. After a queued photo upload succeeds,
replace that durable entry's body with `supporting_artifact_id` and remove its base64 photo
before calling the exception endpoint. If that POST fails or its response is lost, the
next flush reuses both IDs rather than uploading another artifact or inserting another
exception.

- [ ] **Step 5: Avoid upload-on-capture orphans**

For this optional exception form, retain the compressed data URL locally and begin upload
only after Submit. Do not create server evidence for a retaken photo or abandoned form.
Keep the existing terminal-photo-error, storage-quota, and honest receipt behaviours.

- [ ] **Step 6: Add the migration and verify retries**

Use revision `ciaran_exc_idempotency`, down revision `ciaran_corr_capture_time`. Test a
simulated lost response after a committed exception and a transient failure after a
successful photo upload. Both must leave one artifact reference and one exception.

**Developer review checkpoint:** inspect the database after repeated offline flushes and
confirm one logical report produces one exception and does not multiply uploads.

---

### Task 1: Introduce exception review enums and migrate existing evidence

**Files:**
- Modify: `backend/app/db/models/enums.py`
- Modify: `backend/app/db/models/transit.py`
- Modify: `backend/app/schemas/transit.py`
- Create: `backend/migrations/versions/2026_09_06_ciaran_exception_review_semantics.py`
- Modify: `frontend/shared/lib/types/exception.ts`
- Modify: `frontend/shared/lib/mocks/trips.ts`
- Modify: all typed exception fixtures identified by `rg -l "resolved_by_user_id|resolver_note|resolution_method|resolved:" frontend --glob '*.ts' --glob '*.tsx'`
- Test: `backend/tests/unit/test_schema_validators.py`

**Interfaces:**
- Produces: `ExceptionReviewStatus`, stored `ExceptionReviewOutcome`, request-only `DispatcherReviewOutcome`, `ExceptionContactMethod`, `TripExceptionReviewRequest`, and renamed review fields on `TripExceptionRead`/`TripException`.
- Migration base: Task 0B head `ciaran_exc_idempotency`. Re-run `alembic heads` before
  creating the file; if the head changed, stop and coordinate instead of repairing the
  chain automatically.

- [ ] **Step 1: Write schema tests that define the new request contract**

```python
def test_exception_review_requires_note_and_outcome() -> None:
    with pytest.raises(ValidationError):
        TripExceptionReviewRequest(review_note="   ", review_outcome="evidence_verified")


def test_exception_review_allows_no_contact() -> None:
    request = TripExceptionReviewRequest(
        review_note="Photograph confirms the recorded seal.",
        review_outcome=DispatcherReviewOutcome.EVIDENCE_VERIFIED,
        contact_method=None,
    )
    assert request.contact_method is None


def test_exception_review_requires_explicit_contact_choice() -> None:
    with pytest.raises(ValidationError):
        TripExceptionReviewRequest(
            review_note="Photograph confirms the recorded seal.",
            review_outcome="evidence_verified",
        )


def test_exception_review_rejects_migration_only_outcome() -> None:
    with pytest.raises(ValidationError):
        TripExceptionReviewRequest(
            review_note="Historical record.",
            review_outcome="legacy_review",
            contact_method=None,
        )
```

- [ ] **Step 2: Run the four tests and confirm they fail because the new types do not exist**

Run: `cd backend && .venv/bin/pytest tests/unit/test_schema_validators.py -k "exception_review" -q`

- [ ] **Step 3: Add the exact enums and request schema**

```python
class ExceptionReviewStatus(str, enum.Enum):
    RECORDED = "recorded"
    NEEDS_REVIEW = "needs_review"
    REVIEWED = "reviewed"


class ExceptionReviewOutcome(str, enum.Enum):
    NO_ACTION_REQUIRED = "no_action_required"
    HANDLED_EXTERNALLY = "handled_externally"
    EVIDENCE_VERIFIED = "evidence_verified"
    DATA_DISCREPANCY = "data_discrepancy"
    REFERRED_FOR_FOLLOW_UP = "referred_for_follow_up"
    LEGACY_REVIEW = "legacy_review"


class DispatcherReviewOutcome(str, enum.Enum):
    NO_ACTION_REQUIRED = "no_action_required"
    HANDLED_EXTERNALLY = "handled_externally"
    EVIDENCE_VERIFIED = "evidence_verified"
    DATA_DISCREPANCY = "data_discrepancy"
    REFERRED_FOR_FOLLOW_UP = "referred_for_follow_up"


class ExceptionContactMethod(str, enum.Enum):
    PHONE = "phone"
    WHATSAPP = "whatsapp"
    IN_PERSON = "in_person"
```

`TripExceptionReviewRequest` has `review_note: RequiredFreeText`, required
`review_outcome: DispatcherReviewOutcome`, and required-but-nullable
`contact_method: ExceptionContactMethod | None` with no default. Remove the public resolution
request/update fields; rename ORM/read fields to `review_status`, `reviewed_by_user_id`,
`reviewed_at`, `review_note`, `review_outcome`, and `contact_method`.

- [ ] **Step 4: Write the Alembic migration without inventing historical facts**

Use revision `ciaran_exc_review_semantics`, down revision
`ciaran_exc_idempotency`, and this upgrade order:

```python
op.add_column("exceptions", sa.Column("review_status", sa.String(20), nullable=True))
op.add_column("exceptions", sa.Column("review_outcome", sa.String(30), nullable=True))
op.execute("""
UPDATE exceptions
SET review_status = CASE
  WHEN resolved IS TRUE THEN 'reviewed'
  WHEN severity = 'critical' THEN 'needs_review'
  ELSE 'recorded'
END,
review_outcome = CASE WHEN resolved IS TRUE THEN 'legacy_review' ELSE NULL END
""")
op.alter_column("exceptions", "review_status", nullable=False, server_default="recorded")
op.alter_column("exceptions", "resolved_by_user_id", new_column_name="reviewed_by_user_id")
op.alter_column("exceptions", "resolved_at", new_column_name="reviewed_at")
op.alter_column("exceptions", "resolver_note", new_column_name="review_note")
op.alter_column("exceptions", "resolution_method", new_column_name="contact_method")
op.execute("UPDATE exceptions SET contact_method = NULL WHERE contact_method = 'no_contact_yet'")
op.execute("UPDATE exceptions SET contact_method = 'phone' WHERE contact_method = 'phoned'")
op.drop_index("ix_exceptions_trip_resolved", table_name="exceptions")
op.drop_column("exceptions", "resolved")
op.create_index(
    "ix_exceptions_trip_review_status",
    "exceptions", ["trip_id", "review_status"], unique=False,
)
```

Downgrade recreates `resolved`, backfills it from `review_status = 'reviewed'`, reverses
the renamed columns and contact values (`phone` -> `phoned`, null remains null), drops
`ix_exceptions_trip_review_status` and the new columns, and recreates
`ix_exceptions_trip_resolved`. Do not add the rejected status-leading archive index
without measured PostgreSQL query-plan evidence.

- [ ] **Step 5: Update the shared TypeScript contract exactly once**

Replace resolution fields/types with `ExceptionReviewStatus`,
`ExceptionReviewOutcome`, `DispatcherReviewOutcome`, `ExceptionContactMethod`, and the
six review fields. The TypeScript request-only outcome must exclude `legacy_review` just
as the backend request enum does. Preserve all existing exception evidence and GPS
fields. Update shared mock exception records so both applications compile against the
real migrated wire shape; do not make the new fields optional merely to avoid updating
fixtures.

- [ ] **Step 6: Verify schema, migration, types, and formatting**

Run:

```bash
cd backend && .venv/bin/pytest tests/unit/test_schema_validators.py -k "exception_review" -q
cd backend && .venv/bin/alembic upgrade head
cd backend && .venv/bin/alembic downgrade ciaran_exc_idempotency
cd backend && .venv/bin/alembic upgrade head
cd frontend/dispatcher && npm run type-check
cd backend && .venv/bin/ruff check app/db/models/enums.py app/db/models/transit.py app/schemas/transit.py migrations/versions/2026_09_06_ciaran_exception_review_semantics.py
```

Expected: all commands pass and the migration round trip preserves rows.

**Developer review checkpoint:** inspect the migration SQL and migrated sample rows before committing.

---

### Task 2: Assign review state centrally at every exception creation site

**Files:**
- Modify: `backend/app/orchestration/exception_service.py`
- Modify: exception construction sites in `backend/app/orchestration/phase_service.py`, `backend/app/orchestration/trip_service.py`, and `backend/app/orchestration/scan_service.py` only where required to call the helper
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trips/page.tsx`
- Modify: `frontend/driver-pwa/lib/types/driver-trip.ts`
- Modify: affected driver-PWA tests and dispatcher `ChecklistRow`/`useTrips` tests
- Test: `backend/tests/unit/test_exception_service.py`
- Test: `backend/tests/unit/test_scan_service.py`
- Test: `backend/tests/unit/test_phase_service.py`
- Test: `backend/tests/integration/test_exceptions.py`
- Modify/test: `backend/tests/integration/test_gps_mismatch.py`

**Interfaces:**
- Produces: `initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus`.
- Consumes: Task 1 enums and ORM fields.

- [ ] **Step 1: Write failing parameterised tests for initial state**

```python
@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        (ExceptionSeverity.CRITICAL, ExceptionReviewStatus.NEEDS_REVIEW),
        (ExceptionSeverity.WARNING, ExceptionReviewStatus.RECORDED),
        (ExceptionSeverity.INFO, ExceptionReviewStatus.RECORDED),
    ],
)
def test_initial_review_status_is_derived_from_severity(severity, expected) -> None:
    assert initial_review_status(severity) == expected
```

- [ ] **Step 2: Run the focused tests and confirm the missing helper failure**

Run: `cd backend && .venv/bin/pytest tests/unit/test_exception_service.py -q`

- [ ] **Step 3: Implement the pure helper and use it for all new exceptions**

```python
def initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:
    return (
        ExceptionReviewStatus.NEEDS_REVIEW
        if severity == ExceptionSeverity.CRITICAL
        else ExceptionReviewStatus.RECORDED
    )
```

Every `TripException(...)` construction must set `review_status` through this helper or
through one creation function that calls it. Do not hand-code status at individual sites.

There are **ten** construction sites as of the FP-68 geofence merge (commit `8c5af36`):
seven in `phase_service.py`, one each in `trip_service.py`, `scan_service.py`, and
`exception_service.py`. The seventh in `phase_service.py` is FP-145's GPS_MISMATCH in
`_raise_position_disagreement_if_unrecorded` — it is WARNING, so `RECORDED` is its
correct target, but it must still route through the helper rather than inherit the
column's `server_default`; a site that only works by default is a site the next severity
change breaks silently.

`tests/unit/test_realtime_emit.py::test_every_trip_exception_write_site_is_accounted_for`
holds the authoritative count. Re-run `rg -n "TripException\(" backend/app` after ANY
merge from `dev` before trusting this list — it is a snapshot of a moving target.

- [ ] **Step 4: Preserve duplicate suppression semantics explicitly**

Replace both `TripException.resolved.is_(False)` duplicate predicates at
`scan_service.py`'s parcel-count discrepancy check and `phase_service.py`'s corresponding
check with:

```python
TripException.review_status != ExceptionReviewStatus.REVIEWED
```

Do not map these predicates to `NEEDS_REVIEW`: parcel-count mismatch is WARNING and is
initially `RECORDED`, so that mapping would manufacture a duplicate on every poll. Add a
regression test proving a repeated unchanged scan/feed completion creates one recorded
row until that row is reviewed.

- [ ] **Step 5: Replace dispatcher and driver “open exception” counts**

In both dispatcher and driver trip-list services, count only
`review_status == ExceptionReviewStatus.NEEDS_REVIEW`. Rename
`open_exception_count` to `needs_review_count` in both backend response schemas,
`frontend/shared/lib/types/trip.ts`, `frontend/driver-pwa/lib/types/driver-trip.ts`, the
driver demo projection, dispatcher `useTrips`, `ChecklistRow`, and their tests. The
driver receives the count for display compatibility but gains no review workflow.

- [ ] **Step 6: Preserve the driver in-transit incident banner semantics**

The filter in `InTransitPageClient.tsx` is `!e.resolved && e.source !== 'system'` — the
source clause arrived with the FP-68 geofence merge and keeps system-detected findings
(GPS_MISMATCH among them) out of the driver's incident banner. Change ONLY the first
clause: `e.review_status !== 'reviewed' && e.source !== 'system'`. Dropping the source
clause would put every system measurement in front of the driver.

It must continue showing both recorded warnings and needs-review critical incidents
until reviewed; mapping it to `needs_review` would silently remove warning incidents
from the driver's current-trip context.

- [ ] **Step 7: Run exception, dedup, dispatcher trip-list, and driver-PWA tests**

Run: `cd backend && .venv/bin/pytest tests/unit/test_exception_service.py tests/unit/test_scan_service.py tests/unit/test_phase_service.py tests/integration/test_exceptions.py tests/integration/test_gps_mismatch.py tests/integration/test_trips.py -q`

Run: `cd frontend/driver-pwa && npm test -- --run 'app/(app)/trip/in-transit' 'app/(app)/trips' && npm run type-check`

Expected: critical creations need review; warning/info creations are recorded; trip counts include only needs-review rows.

**Developer review checkpoint:** search `TripException(` and confirm every constructor follows the helper invariant.

---

### Task 3: Replace resolve with immutable review while preserving concurrency guarantees

**Files:**
- Modify: `backend/app/orchestration/exception_service.py`
- Modify: `backend/app/api/v1/endpoints/exceptions.py`
- Rename/modify: `backend/tests/integration/test_exception_resolve_concurrency.py` to `backend/tests/integration/test_exception_review_concurrency.py`
- Modify: `backend/tests/integration/test_exceptions.py`
- Modify: `backend/tests/integration/test_exceptions_dispatcher.py`
- Read-only regression: `backend/tests/unit/test_exceptions.py` (no renamed surface; it tests only core domain exception classes)

**Interfaces:**
- Produces: `review_exception(db, *, exception_id, user_id, organization_id, review_note: str, review_outcome: DispatcherReviewOutcome, contact_method: ExceptionContactMethod | None) -> TripExceptionRead`.
- Produces: `PATCH /api/v1/exceptions/{exception_id}/review`.

- [ ] **Step 1: Convert endpoint tests to the new language and add terminal-trip cases**

Tests must prove:

```python
@pytest.mark.parametrize("trip_status", [TripStatus.ACTIVE, TripStatus.CLOSED, TripStatus.CANCELLED])
async def test_dispatcher_can_review_without_changing_trip_status(...):
    before = trip.status
    response = await client.patch(
        f"/api/v1/exceptions/{exception.id}/review",
        headers=auth_header(dispatcher),
        json={
            "review_note": "Evidence checked.",
            "review_outcome": "evidence_verified",
            "contact_method": None,
        },
    )
    assert response.status_code == 200
    assert trip.status == before
```

Also cover recorded -> reviewed, needs_review -> reviewed, blank note 422, missing outcome
422, missing `contact_method` 422, explicit null contact 200, migration-only outcome 422,
cross-org 404, same-user replay unchanged, different-user 409, and review metadata coming
from the token/server clock.

- [ ] **Step 2: Run focused tests and confirm failures reference the old route/fields**

Run: `cd backend && .venv/bin/pytest tests/integration/test_exceptions.py tests/integration/test_exception_review_concurrency.py -q`

- [ ] **Step 3: Rename and update the service without weakening its lock**

Keep `.with_for_update(of=TripException)`. On the first valid review set all review fields
and return the row. Do not query or branch on `Trip.status` or `PhaseEvent.status`.
Treat `REVIEWED` as terminal. Preserve same-user idempotency and different-user conflict.
Convert request input explicitly when storing it:

```python
exc.review_outcome = ExceptionReviewOutcome(review_outcome.value)
```

- [ ] **Step 4: Replace the API route and exception copy**

Rename `/resolve` to `/review`, accept `TripExceptionReviewRequest`, and change user-facing
error text to “already reviewed by a colleague.” Keep rate limiting and 404/409 mappings.

- [ ] **Step 5: Strengthen the real concurrency assertion**

The independent-connection test must assert the winning `reviewed_by_user_id`,
`review_note`, `review_outcome`, and `contact_method`; exactly one different-user request
returns 409 across repeated runs.

- [ ] **Step 6: Run the review suites repeatedly**

Run:

```bash
cd backend && .venv/bin/pytest tests/integration/test_exceptions.py tests/integration/test_exceptions_dispatcher.py tests/unit/test_exceptions.py -q
cd backend && .venv/bin/pytest tests/integration/test_exception_review_concurrency.py -q
```

Run the concurrency command five times, in the foreground, with no other pytest process
running. This suite uses real independent connections and commits rather than the shared
transaction fixture. Expected: all five runs pass; no trip or phase lifecycle fields
change. Do not add a pytest-repeat dependency for this.

**Developer review checkpoint:** compare the lock query to the previously verified FP-146 fix.

---

### Task 4: Make exception realtime events precise and complete

**Files:**
- Modify: `backend/app/core/realtime.py`
- Modify: `backend/app/orchestration/exception_service.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Modify: `backend/app/orchestration/trip_service.py`
- Modify: `frontend/dispatcher/lib/realtime/types.ts`
- Modify: `frontend/dispatcher/lib/realtime/useLiveResource.ts`
- Modify: `frontend/dispatcher/lib/realtime/ranking.ts`
- Modify: `frontend/dispatcher/components/ui/Toast.tsx`
- Modify: `frontend/dispatcher/lib/context/ToastContext.tsx`
- Test: `backend/tests/unit/test_realtime.py`
- Test: `backend/tests/unit/test_realtime_emit.py`
- Test: `frontend/dispatcher/lib/realtime/useLiveResource.test.tsx`
- Test: `frontend/dispatcher/lib/realtime/ranking.test.ts`

**Interfaces:**
- Adds: `RealtimeKind.EXCEPTION_REVIEWED = "exception_reviewed"`.
- Extends: `useLiveResource(resource, id, refetch, { kinds?: RealtimeKind[] })`.

- [ ] **Step 1: Write failing invariant and kind-filter tests**

Backend tests prove phase override and trip cancellation each enqueue
`EXCEPTION_RAISED` alongside their lifecycle event, and a first review enqueues
`EXCEPTION_REVIEWED` at info severity. Frontend tests prove unrelated kinds do not call
the callback and selected kinds do. Ranking tests require critical raises to remain
sticky errors and warning raises to become ordinary `warning` toasts that auto-dismiss.

- [ ] **Step 2: Run focused tests and confirm the missing kind/filter failures**

Run: `cd backend && .venv/bin/pytest tests/unit/test_realtime.py tests/unit/test_realtime_emit.py -q`

Run: `cd frontend/dispatcher && npm test -- --run lib/realtime/useLiveResource.test.tsx lib/realtime/ranking.test.ts`

- [ ] **Step 3: Close the exception-write emit invariant**

Add `EXCEPTION_RAISED` at the two known gaps: dispatcher-note creation during phase
override and during trip cancellation. Retain their existing lifecycle event too.

- [ ] **Step 4: Emit a distinct review event and support client kind filtering**

Enqueue `EXCEPTION_REVIEWED` only for a first review, never an idempotent replay. Extend
wire types and filtering. `toastForEvent` stays silent for `EXCEPTION_REVIEWED`; critical
raises retain `kind: 'error'` and critical priority, while warning raises use
`kind: 'warning'`, ordinary priority, and the existing four-second auto-dismiss. Update
the stale INFO-gate comment: after the new kind, INFO `exception_raised` means a genuinely
informational raise, not a review disguised as `exception_raised`.

Also update Toast/ToastContext comments that currently claim every exception alert is an
error or list only info/success as auto-dismissing. Behaviour and rationale must describe
warning toasts consistently.

- [ ] **Step 5: Re-run backend/frontend realtime suites**

Expected: every exception write is discoverable, review removes queue items live, and
phase-only events no longer refetch exception screens.

**Developer review checkpoint:** verify realtime JSON still contains only resource, ID, kind, severity, and timestamp.

---

### Task 5: Add reusable cursor primitives and response envelope

**Files:**
- Create: `backend/app/core/pagination.py`
- Create: `backend/app/schemas/pagination.py`
- Create: `backend/tests/unit/test_pagination.py`

**Interfaces:**
- Produces: `CursorPosition(created_at: datetime, id: UUID)`.
- Produces: `encode_cursor(position: CursorPosition) -> str` and `decode_cursor(value: str) -> CursorPosition`.
- Produces: `CursorPage[T]` with `items`, `next_cursor`, and `total_items`.

- [ ] **Step 1: Write round-trip and rejection tests**

```python
def test_cursor_round_trip_preserves_timestamp_and_uuid() -> None:
    position = CursorPosition(created_at=datetime(2026, 9, 6, tzinfo=UTC), id=uuid4())
    assert decode_cursor(encode_cursor(position)) == position


@pytest.mark.parametrize("value", ["", "not-base64", "e30="])
def test_cursor_rejects_malformed_values(value: str) -> None:
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)
```

- [ ] **Step 2: Run and observe missing-module failures**

Run: `cd backend && .venv/bin/pytest tests/unit/test_pagination.py -q`

- [ ] **Step 3: Implement URL-safe opaque cursor encoding**

Encode compact JSON containing ISO-8601 `created_at` and UUID `id` with URL-safe base64.
Decode strictly: exactly those keys, timezone-aware timestamp, valid UUID, one stable
`ValueError("Invalid pagination cursor")` for all malformed input. Do not put filter data
or PII in the cursor.

- [ ] **Step 4: Implement the generic Pydantic envelope**

```python
T = TypeVar("T")

class CursorPage(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None
    total_items: int = Field(ge=0)
```

- [ ] **Step 5: Run unit, Ruff, and mypy checks**

Run: `cd backend && .venv/bin/pytest tests/unit/test_pagination.py -q && .venv/bin/ruff check app/core/pagination.py app/schemas/pagination.py && .venv/bin/mypy app/core/pagination.py app/schemas/pagination.py`

**Developer review checkpoint:** decode several malformed cursors manually and confirm none expose stack details through the future API.

---

### Task 6: Add exception queue, history, and detail read contracts

**Files:**
- Modify: `backend/app/schemas/transit.py`
- Modify: `backend/app/orchestration/exception_service.py`
- Modify: `backend/app/orchestration/artifact_service.py`
- Modify: `backend/app/api/v1/endpoints/exceptions.py`
- Reuse: `backend/app/schemas/evidence.py`
- Create: `backend/tests/integration/test_exception_reads.py`

**Interfaces:**
- Produces: `GET /api/v1/exceptions/review-queue -> list[TripExceptionListItem]`.
- Produces: `GET /api/v1/exceptions/history -> CursorPage[TripExceptionListItem]`.
- Produces: `GET /api/v1/exceptions/{id} -> TripExceptionDetail`.

- [ ] **Step 1: Write endpoint tests for state separation and detail independence**

Test that queue returns only `needs_review`, history returns only `recorded/reviewed`, a
closed-trip exception is retrievable by ID, direct detail is independent of archive page,
and cross-org detail is 404.

- [ ] **Step 2: Write cursor/filter tests**

Seed tied timestamps and prove `(created_at, id)` gives no duplicate/omitted rows across
pages. Cover `q`, status, severity, inclusive SA date bounds, exact `total_items`, limit
1/100, limit 0/101 returning 422, and malformed cursor returning 422.

- [ ] **Step 3: Run tests and confirm the new routes are absent**

Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_reads.py -q`

- [ ] **Step 4: Add compact list and rich detail schemas**

List rows carry exception ID/type/source/severity/status/description/timestamp, trip
ID/reference/status, and phase/stop labels. Detail additionally carries complete review
evidence, trip `closed_at`, GPS values already authorised by the existing exception read,
and the one linked `EvidenceArtifactWithUrl` when present. Keep
`supporting_artifact_id` as the immutable reference even if signing fails; in that case
the nested artifact remains present with `signed_url: null` so the UI can distinguish
“recorded, image unavailable” from “no photo”.

- [ ] **Step 5: Implement organisation-scoped queries**

Queue is unbounded but state-limited and newest-first. History applies filters to both
the page and count statements, fetches `limit + 1`, encodes the last returned row, and
uses a tuple comparison below the cursor. Detail uses one joined query and left joins
optional phase/stop context. Resolve and sign only the exception's same-trip supporting
artifact through `artifact_service`; never fetch every trip artifact and never trust the
artifact ID without the Task 0B ownership invariant. Never fetch all exceptions to find
one.

- [ ] **Step 6: Declare static routes before `/{exception_id}` and map cursor errors to 422**

FastAPI route ordering must prevent `history` and `review-queue` being parsed as UUIDs.
Use `Query(default=25, ge=1, le=100)` and a stable 422 detail for invalid cursors.

- [ ] **Step 7: Retire the old undifferentiated read contract**

Delete `list_exceptions()` from `exception_service.py` and `GET ""` from
`endpoints/exceptions.py` after queue/history/detail are present. `useExceptions()` is
their last frontend consumer and is retired only after Tasks 9 and 10 move both pages to
their dedicated hooks. No final source reference may remain to
`TripException.resolved`, which the Task 1 migration removes.

- [ ] **Step 8: Run exception integration tests**

Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_reads.py tests/integration/test_exceptions.py tests/integration/test_exception_scoping.py -q`

Expected: all read/mutation contracts pass with org isolation.

**Developer review checkpoint:** inspect generated OpenAPI for three distinct read response shapes.

---

### Task 7: Build and test the universal dispatcher Pagination component

**Files:**
- Create: `frontend/dispatcher/components/ui/Pagination.tsx`
- Create: `frontend/dispatcher/components/ui/Pagination.test.tsx`

**Interfaces:**
- Produces:

```typescript
export interface PaginationProps {
  page: number
  pageSize: number
  itemCount: number
  totalItems: number
  hasPrevious: boolean
  hasNext: boolean
  isLoading?: boolean
  onPrevious: () => void
  onNext: () => void
}
```

- [ ] **Step 1: Write failing rendering, interaction, and accessibility tests**

Test `1–25 of 137`, `Page 1`, both callbacks, first/last-page disabled states, loading
disabled state, `aria-label="Previous page"`, `aria-label="Next page"`, and zero results.

- [ ] **Step 2: Run the component test and observe missing-component failure**

Run: `cd frontend/dispatcher && npm test -- --run components/ui/Pagination.test.tsx`

- [ ] **Step 3: Implement a presentation-only component**

Compute the range from `page`, `pageSize`, and `itemCount`; render existing `Button`
components and dispatcher design tokens. Do not fetch, encode cursors, own filters, or
import exception/trip types.

- [ ] **Step 4: Run component tests, TypeScript, and lint**

Run: `cd frontend/dispatcher && npm test -- --run components/ui/Pagination.test.tsx && npm run type-check && npm run lint`

**Developer review checkpoint:** keyboard-tab through both controls and inspect at narrow desktop width.

---

### Task 8: Replace exception frontend hooks with queue/history/detail responsibilities

**Files:**
- Replace responsibilities in: `frontend/dispatcher/lib/hooks/useExceptions.ts`
- Create: `frontend/dispatcher/lib/hooks/useExceptionHistory.ts`
- Create: `frontend/dispatcher/lib/hooks/useExceptionDetail.ts`
- Modify: `frontend/dispatcher/lib/realtime/useLiveResource.ts`
- Modify/create tests: `frontend/dispatcher/lib/hooks/useExceptions.test.tsx`, `useExceptionHistory.test.tsx`, `useExceptionDetail.test.tsx`

**Interfaces:**
- Produces: `useExceptionQueue()` with items/loading/error/refetch.
- Produces: `useExceptionHistory(filters)` with page data, cursor-stack actions, and filter reset.
- Produces: `useExceptionDetail(id)` with one detail record and silent refetch.

- [ ] **Step 1: Write request-shape and lifecycle tests**

Prove queue calls only `/review-queue`; detail calls only `/{id}`; history URL-encodes all
filters; Next/Previous maintain a cursor stack; filter changes reset page/cursor; and a
late older response cannot overwrite a newer filter response.

- [ ] **Step 2: Run hook tests and confirm failures use the old all-record endpoint**

Run: `cd frontend/dispatcher && npm test -- --run lib/hooks/useExceptions.test.tsx lib/hooks/useExceptionHistory.test.tsx lib/hooks/useExceptionDetail.test.tsx`

- [ ] **Step 3: Implement dedicated hooks without changing shared `useAsyncData`**

Queue/detail may use `useAsyncData` with stable callbacks. History owns its changing
request effect, increments a request-generation ref, and applies results only when the
generation is current. Keep previous rows visible during a failed refresh and expose a
stale warning.

- [ ] **Step 4: Limit realtime subscriptions**

Queue subscribes to `exception_raised` and `exception_reviewed`. Detail subscribes to
both kinds for its trip ID. History does not subscribe. Never subscribe exception hooks
to all trip events.

- [ ] **Step 5: Run hook and realtime tests**

Expected: direct detail works independently; filter/cursor races cannot display the
wrong page; unrelated phase events trigger no request.

**Developer review checkpoint:** inspect network mocks to confirm no hook downloads all exceptions.

---

### Task 9: Redesign the Exceptions list as attention queue plus paginated history

**Files:**
- Modify: `frontend/dispatcher/app/(app)/exceptions/page.tsx`
- Create/modify: `frontend/dispatcher/app/(app)/exceptions/page.test.tsx`
- Modify: `frontend/shared/lib/constants/copy.ts`

**Interfaces:**
- Consumes: Tasks 6-8 queue/history hooks and `Pagination`.
- Produces: Needs Review and History tab UI.

- [ ] **Step 1: Write page tests before changing markup**

Cover queue count, archive total, no pagination in Needs Review, pagination in History,
server-filter callbacks, row trip/phase/status context, correct empty states, retained
rows plus stale banner on refresh failure, and navigation to the detail route.

- [ ] **Step 2: Run the page test and confirm old Open/Resolved assumptions fail**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/exceptions/page.test.tsx'`

- [ ] **Step 3: Implement the two-tab page**

Use “Needs Review” and “History”; remove Open/Resolved copy. Queue rows make trip lifecycle
and phase context scannable. History adds debounced search, status, severity, and date
filters; each filter change resets pagination through the hook.

- [ ] **Step 4: Preserve honest loading/error states**

Initial failure must never render an all-clear empty state. Background failures retain
real rows and label them potentially stale. Disable pagination controls while a page
request is in flight.

- [ ] **Step 5: Verify sidebar and responsive behaviour**

Keep the existing staged Exceptions sidebar entry and its test. Check row layout at
desktop and narrow drawer widths without modifying the driver PWA.

- [ ] **Step 6: Run exception page, sidebar, pagination, type, and lint tests**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/exceptions/page.test.tsx' components/layout/__tests__/Sidebar.test.tsx components/ui/Pagination.test.tsx && npm run type-check && npm run lint`

**Developer review checkpoint:** manually compare Needs Review and History with active, closed, and cancelled trip fixtures.

---

### Task 10: Redesign exception detail and review form

**Files:**
- Modify: `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/exceptions/[id]/page.test.tsx`
- Reuse/modify if necessary: `frontend/dispatcher/components/domain/ExceptionEvidence.tsx`
- Reuse: `frontend/dispatcher/components/domain/EvidencePhoto.tsx`
- Modify: `frontend/shared/lib/constants/copy.ts`

**Interfaces:**
- Consumes: `useExceptionDetail`, new review API fields, and `PATCH /review`.
- Produces: terminal-trip-safe review experience.

- [ ] **Step 1: Rewrite tests around review semantics**

Tests cover active/closed/cancelled lifecycle banners, explanatory non-blocking copy,
phase context, required note/outcome, a blank UI contact choice sent explicitly as null,
recorded optional review action, reviewed evidence rendering, a linked supporting photo
with provenance, an explicit image-unavailable state, success navigation, 409 colleague
handling, and handler guards against keyboard submission with missing required fields.

- [ ] **Step 2: Run tests and observe failures against resolution copy/API**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/exceptions/[id]/page.test.tsx'`

- [ ] **Step 3: Use the dedicated detail hook and `/review` mutation**

Remove the full-list lookup. Keep the first loaded record visible during a failed silent
refresh. Rename local variables/actions from resolve to review.

- [ ] **Step 4: Implement form and evidence states**

Outcome starts blank and is required. Contact starts blank and is optional. Note is
trimmed and required. Show: “Reviewing records your assessment. It does not change or
reopen the trip.” A reviewed record displays outcome, note, optional contact method,
review time, and reviewer attribution permitted by the schema. Reuse `ExceptionEvidence`
and `EvidencePhoto` against the nested detail artifact; do not call
`GET /trips/{trip_id}/artifacts` from the exception detail page.

- [ ] **Step 5: Run detail tests and all exception frontend tests**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/exceptions' lib/hooks/useExceptionDetail.test.tsx lib/hooks/useExceptionHistory.test.tsx components/ui/Pagination.test.tsx`

Expected: all pass; no “resolve/open” task language remains except migration compatibility comments.

**Developer review checkpoint:** review a critical exception on a closed trip in the local UI and confirm the trip remains closed.

---

### Task 11: Exception-stage completion gate

**Files:** No production changes unless verification exposes a defect.

**Interfaces:** This gate must pass before any Trip History work starts.

- [ ] **Step 1: Search for stale public resolution terminology**

Run:

```bash
rg -n "TripException\.resolved|\.resolved_by_user_id|resolver_note|resolution_method|no_contact_yet|resolve_exception|Open Exceptions" backend/app frontend/dispatcher frontend/driver-pwa frontend/shared backend/tests/integration/test_gps_mismatch.py
```

Every hit must be a migration/downgrade compatibility reference or be removed. Then run
`rg -n "\bresolved\b" backend/app frontend/dispatcher frontend/driver-pwa frontend/shared`
and manually classify the remaining phase-ledger language; do not suppress
`phase_service.py` with a directory glob that does not match it.

- [ ] **Step 2: Run all exception, realtime, and migration-focused backend tests**

Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_reads.py tests/integration/test_exceptions.py tests/integration/test_exceptions_dispatcher.py tests/integration/test_exception_scoping.py tests/integration/test_exception_review_concurrency.py tests/integration/test_gps_mismatch.py tests/integration/test_phase_corroboration.py tests/unit/test_exceptions.py tests/unit/test_exception_service.py tests/unit/test_scan_service.py tests/unit/test_phase_service.py tests/unit/test_corroboration_service.py tests/unit/test_pulsit_client.py tests/unit/test_realtime.py tests/unit/test_realtime_emit.py tests/unit/test_pagination.py -q`

- [ ] **Step 3: Run all dispatcher exception and pagination tests**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/exceptions' lib/hooks/useExceptions.test.tsx lib/hooks/useExceptionHistory.test.tsx lib/hooks/useExceptionDetail.test.tsx components/ui/Pagination.test.tsx lib/realtime`

- [ ] **Step 4: Run static checks**

Run:

```bash
cd backend && .venv/bin/ruff check app tests
cd backend && .venv/bin/mypy app
cd frontend/dispatcher && npm run type-check
cd frontend/dispatcher && npm run lint
```

Expected: every command passes. Do not start Task 12 if this gate fails.

**Developer review checkpoint:** approve the complete exception workflow before Trip History begins.

---

### Task 12: Add the dedicated cursor-paginated Trip History API

**Files:**
- Modify: `backend/app/schemas/trips.py`
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `backend/app/api/v1/endpoints/trips.py`
- Create: `backend/migrations/versions/2026_09_06_ciaran_trip_history_pagination.py`
- Create: `backend/tests/integration/test_trip_history.py`

**Interfaces:**
- Produces: `GET /api/v1/trips/history -> CursorPage[TripHistoryListItemResponse]`.
- Preserves: `GET /api/v1/trips -> list[TripListItemResponse]` unchanged.

- [ ] **Step 1: Write compatibility and history contract tests**

Prove `/trips` still returns an array. Prove `/trips/history` contains only closed and
cancelled trips, uses `closed_at`, is org-scoped, returns exact filtered totals, and
orders tied `(closed_at, id)` values without duplicates across cursors.

- [ ] **Step 2: Add filter/validation tests**

Cover search by trip reference/order/driver name, origin-or-destination precinct,
inclusive SA date range, bad cursor 422, limit bounds, and a cross-org row excluded from
both page and total.

- [ ] **Step 3: Run tests and confirm the new route is absent**

Run: `cd backend && .venv/bin/pytest tests/integration/test_trip_history.py -q`

- [ ] **Step 4: Add terminal-trip backfill and supporting index**

Use revision `ciaran_trip_history_page`, down revision `ciaran_exc_review_semantics`:

```python
op.execute("""
UPDATE trips SET closed_at = updated_at
WHERE status IN ('closed', 'cancelled') AND closed_at IS NULL
""")
op.create_index(
    "ix_trips_org_status_closed_id",
    "trips", ["operator_organization_id", "status", "closed_at", "id"], unique=False,
)
```

Downgrade drops only the index; it must not erase the defensible timestamp backfill.

- [ ] **Step 5: Add a purpose-specific history schema and query**

Include `closed_at` and all fields required by `ChecklistRow`, but do not add phase plans,
exceptions, receipts, or manifests. Filter statuses in SQL, join Driver for search and
display, apply route/date/search filters before count/page queries, fetch `limit + 1`,
and cursor on `(closed_at, id)`.

- [ ] **Step 6: Register `/history` before `/{trip_id}`**

Accept `q`, `precinct_id`, `from_date`, `to_date`, `limit`, and `cursor`. Convert inclusive
SA dates to UTC half-open boundaries `[from midnight, day-after-to midnight)` using
`settings.OPERATIONS_UTC_OFFSET_HOURS`; do not introduce a literal `+02:00` or another
timezone setting.

- [ ] **Step 7: Run history and existing trip tests**

Run: `cd backend && .venv/bin/pytest tests/integration/test_trip_history.py tests/integration/test_trips.py tests/integration/test_trips_driver_list.py -q`

Expected: new history tests pass and existing dispatcher/driver list contracts remain unchanged.

**Developer review checkpoint:** confirm no existing `/trips` consumer or response type changed.

---

### Task 13: Move Trip History filters server-side and reuse Pagination

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useTripHistory.ts`
- Create: `frontend/dispatcher/lib/hooks/useTripHistory.test.tsx`
- Modify: `frontend/dispatcher/app/(app)/history/page.tsx`
- Create/modify: `frontend/dispatcher/app/(app)/history/page.test.tsx`
- Modify: `frontend/shared/lib/types/trip.ts`

**Interfaces:**
- Consumes: Task 12 endpoint and Task 7 `Pagination`.
- Produces: cursor-paginated, filterable Trip History without changing `useTrips`.

- [ ] **Step 1: Write hook tests**

Prove query encoding, cursor stack, filter reset, stale-response rejection, and only
`trip_closed` events triggering updates. On page one the event silently refetches; on a
later page it sets `hasNewHistory` without moving pages.

- [ ] **Step 2: Write page tests**

Prove the page uses server totals, renders `closed_at`, passes search/date/route filters
to the hook, displays Pagination, and the “New trip history available” action returns to
and refreshes page one.

- [ ] **Step 3: Run tests and observe old client-filter behaviour fail**

Run: `cd frontend/dispatcher && npm test -- --run lib/hooks/useTripHistory.test.tsx 'app/(app)/history/page.test.tsx'`

- [ ] **Step 4: Implement the dedicated hook**

Use the same cursor-stack and request-generation rules as exception history, expressed
in this trip-specific hook rather than coupling the UI component to either resource.
Debounce text search; reset cursor immediately for select/date filters.

- [ ] **Step 5: Replace only the History page data source**

Remove `useTrips({status: ...})` and client filtering. Keep precinct lookup for selector
labels, existing resizable columns, row navigation, honest loading/errors, and the
existing empty/no-results distinction. Render the shared Pagination footer.

- [ ] **Step 6: Run history, active-dashboard, and trip-creation frontend tests**

Run: `cd frontend/dispatcher && npm test -- --run 'app/(app)/history' lib/hooks/useTripHistory.test.tsx 'app/(app)/page' 'app/(app)/trips/new' components/ui/Pagination.test.tsx`

Expected: history uses the new endpoint while active trips and trip creation continue using `useTrips`.

**Developer review checkpoint:** create/close a trip locally and verify page-one live update plus later-page non-disruption.

---

### Task 14: Full verification and handoff

**Files:** No planned production changes; fix only defects caused by the tasks above.

- [ ] **Step 1: Run the complete backend suite**

Run: `cd backend && .venv/bin/pytest`

Expected: all tests pass; only documented pre-existing warnings remain.

- [ ] **Step 2: Run complete backend static analysis**

Run: `cd backend && .venv/bin/ruff check app tests && .venv/bin/mypy app`

- [ ] **Step 3: Run the complete dispatcher suite and production checks**

Run:

```bash
cd frontend/dispatcher && npm test -- --run
cd frontend/dispatcher && npm run type-check
cd frontend/dispatcher && npm run lint
cd frontend/dispatcher && npm run build
```

- [ ] **Step 4: Verify the shared exception type did not break the driver PWA**

Run:

```bash
cd frontend/driver-pwa && npm test -- --run
cd frontend/driver-pwa && npm run type-check
cd frontend/driver-pwa && npm run build
```

- [ ] **Step 5: Perform the local end-to-end matrix**

Verify: warning appears only in History; critical appears in Needs Review; unrelated
phase completion causes no exception refetch; active/closed/cancelled critical records
can be reviewed without lifecycle mutation; review disappears from queue and appears in
History; direct detail URL works beyond page one; filters reset pagination; trip history
uses close date; new closed trip updates page one without disrupting later pages. Also
verify a deliberately delayed offline handshake creates no GPS mismatch, a queued
exception whose first response is lost produces one row, and its supporting photograph
renders directly on exception detail.

- [ ] **Step 6: Inspect the final diff and migration heads**

Run:

```bash
git diff --check
git status --short
cd backend && .venv/bin/alembic heads
```

Expected: no whitespace errors, one Alembic head (`ciaran_trip_history_page`), no secrets,
and no files outside the spec scope.

**Developer handoff:** review and commit logical stages manually. Suggested commit sequence:

1. `fix(corroboration): reject temporally unrelated tracker fixes`
2. `fix(exceptions): make driver reports and artifacts replay-safe`
3. `refactor(orchestration): replace exception resolution with evidence review`
4. `feat(api): add exception queue detail and cursor history contracts`
5. `feat(dispatcher): redesign exception review and history surfaces`
6. `feat(api): add cursor-paginated trip history`
7. `feat(dispatcher): paginate trip history with shared controls`
