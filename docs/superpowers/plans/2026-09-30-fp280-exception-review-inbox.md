# FP-280 — Every exception is reviewed: unreviewed inbox, claim, review status everywhere

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No exception can exist without eventually appearing in the dispatcher's unreviewed inbox. Every exception can be claimed, released, taken over and reviewed, and the claimer and reviewer are shown by name on the exceptions page and on every exception in the trip timeline.

**Architecture:** A new leaf module, `review_policy.py`, becomes the single rule for how an exception enters review. Everything starts `needs_review`, except a dispatcher's own override or cancel note, which is saved already reviewed by its author. "Claimed" is not a new review status: it is `needs_review` plus two new columns (`claimed_by_user_id`, `claimed_at`), so the history filter, analytics and counts keep working. Claim, release, take-over and per-trip batch review are new dispatcher endpoints on the existing `/exceptions` router. The dispatcher UI splits the existing single queue fetch into "Unreviewed" and "Claimed by me" tabs on the client.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Alembic (hand-written migration), pytest-asyncio; Next.js 15 App Router, React 19, TypeScript 5.5, vitest.

**Spec:** Jira FP-280 (text quoted in the session), plus `docs/superpowers/specs/2026-09-23-exception-workflow-design.md` §2.1 and §5.2, and `docs/design-notes/2026-09-04-exception-queue-scaling.md`. Where this plan and the spec disagree, **this plan wins**. The decisions below were confirmed by Ciaran on 2026-09-30.

## Decisions (confirmed 2026-09-30 — do not re-litigate)

| # | Decision |
|---|---|
| D1 | Every exception starts `needs_review`, whatever its severity or source. `initial_review_status()` returns `NEEDS_REVIEW` unconditionally. |
| D2 | A dispatcher's own note (the `DISPATCHER_NOTE` written by phase override and by trip cancel) is saved **already reviewed by its author**: `review_status=reviewed`, `review_outcome=dispatcher_authored`, reviewer = claimer = the acting dispatcher, and the time = when it was written. It never enters the inbox. The *system* `SEAL_UNVERIFIED` warning written by an arrival override is not authored, so it goes to the inbox as normal. |
| D3 | The migration backfills every existing `recorded` row to `needs_review`, and changes the column's server default to `needs_review`. |
| D4 | Batch review is **per trip** (spec §5.2): non-critical rows only, all on one trip, with an explicit list of ids, capped at 100. **Future, not this story:** cross-trip bulk review from the org inbox. |
| D5 | **Soft claim** — the ownership model used by Sentinel, Splunk ES and PagerDuty (the research is summarised in the session of 2026-09-30). Claiming is optional; it tells the team "I'm on it". **Anyone can take over, in one explicit step:** either **Take over** (a claim with `take_over: true`) or **Take over and review** (a review with `take_over: true`). A take-over replaces the claimer and is logged with both user ids. The server never locks anyone out. It only refuses to *silently* override a colleague: a claim or review that meets a colleague's claim **without** `take_over: true` gets a 409. That is stale-page protection — the page was loaded before the claim — not a lock. Only the claimer can release; anyone else takes over instead. |
| D6 | **Reviewing auto-claims.** When you review an unclaimed row, the same locked transaction stamps you as claimer (at the same instant as `reviewed_at`) and then writes the review. There is no gap in which a colleague can claim it. A reviewed row therefore always names both a claimer and a reviewer. A take-over at review time makes the reviewer the claimer too. The row stores only the current claim; earlier claims are in the log (a claim-history table is a follow-up). If a colleague claimed it after your page loaded, your plain review gets a 409, your note stays in the form, and the page refetches. The button then reads **Take over and review**, and one more press submits the same note. |
| D7 | Scaling-note fixes 1–3 are **already on `dev`**: the emit invariant (`test_realtime_emit.py::test_every_trip_exception_write_site_is_accounted_for`), the queue subscribing by `kinds`, and `GET /exceptions/{id}`. The queue/history split (fix 4) is done too. The one remaining gap: the invariant test covers only 4 of the 7 files that write exceptions. Task 2 closes it. |
| D8 | Dispatcher names are resolved server-side from `users.full_name`, scoped to the caller's organisation. They are **never** added to driver-facing responses (`/trips/me/active` and phase completion both return `TripDetailResponse`). |

## Global Constraints

- **Never run `git commit`, `push`, `merge`, `rebase`, `checkout`, `stash`, `reset` or `restore`** (CLAUDE.md). At the end of each task, `git add` the task's files and write the suggested commit message in the report. Ciaran commits.
- **Never run `alembic upgrade`, `downgrade` or `revision --autogenerate`.** Hand-write the migration. Ciaran runs it from `dev` after merge. The only allowed alembic command is `backend/.venv/bin/alembic heads`, which reads files only.
- Run pytest **in the foreground only**, never in the background: concurrent runs wipe the shared test DB.
- Backend gates, all run from `backend/`: `.venv/bin/ruff check .`, `.venv/bin/mypy .`, `.venv/bin/pytest -m "not slow"`.
- Frontend gates:
  - in `frontend/dispatcher/`: `npm run type-check && npm run lint && npm test`
  - in `frontend/driver-pwa/`: `npm run type-check && npm test`, because `@shared` types change.
- Python: `Mapped`/`mapped_column`, Pydantic v2, every endpoint `async def`, no bare `except`, and no magic numbers (the batch cap lives in `app/core/constants.py`).
- TypeScript: no `any`; explicit prop interfaces; the typed `api` client only, never raw `fetch()`.
- Comments explain *why*, and should match the density of the surrounding code, which is high in this repo.
- Never log `review_note` or any other free text (see the existing comment in `review_exception`). Log ids, outcome and contact method only.
- Out of scope — do not build: the severity policy table, evidence sign-off, follow-up notes, severity upgrade, cross-trip bulk review, a claim-history table, a `raised_by_user_id` column, and any change to `ChecklistRow` styling or to the driver PWA's count semantics.
- Test naming: `test_<what>_<outcome>()`. Arrange/Act/Assert with blank lines between. Build ids from fixtures or `uuid4()`, never hard-coded.

## Review Focus

The five failure modes most likely to hurt a real user. Each one has a pinning test in the task named.

1. **A colleague claims after my page loaded, then I press Review.** Expect 409, the DB left untouched, my typed note preserved, and the button changing to "Take over and review". Pressing it succeeds, and I become claimer and reviewer. Tests: Task 3 `test_review_over_a_colleagues_claim_is_409_and_changes_nothing` and `test_take_over_and_review_in_one_step`, and Task 7's detail-page 409 test.
2. **A warning raised after the trip page loaded must not be swept into a batch review nobody looked at.** Batch review uses explicit ids only. Test: Task 4 `test_batch_review_leaves_unlisted_rows_unreviewed`.
3. **A raw insert with no `review_status` (a future write site, a seed script) must still reach the inbox.** Expect the server default to be `needs_review`. Test: Task 1 `test_exception_without_explicit_status_defaults_to_needs_review`.
4. **Dispatcher names must not leak to the driver app.** Test: Task 3 `test_trip_detail_omits_reviewer_names_unless_asked`.
5. **Releasing after review must not wipe who worked it.** Expect 409, with the claim fields preserved. Test: Task 3 `test_release_after_review_is_409_and_keeps_the_claim`.

---

## File map

**Backend — create**
- `backend/app/orchestration/review_policy.py` — `initial_review_status`, `dispatcher_authored_review`. A leaf module that imports nothing from `app.orchestration`.
- `backend/app/orchestration/review_identity.py` — `user_names`, `name_of`, `with_reviewer_names`. A leaf module that breaks the `exception_service → phase_service → resource_service` import cycle.
- `backend/migrations/versions/2026_09_30_ciaran_exception_claims.py`
- `backend/tests/unit/test_review_policy.py`
- `backend/tests/integration/test_exception_claims.py`
- `backend/tests/integration/test_exception_batch_review.py`

**Backend — modify**
- `app/db/models/enums.py` — `ExceptionReviewOutcome.DISPATCHER_AUTHORED`
- `app/core/realtime.py` — `RealtimeKind.EXCEPTION_CLAIMED`
- `app/core/exceptions.py` — `ExceptionClaimedByColleagueError`, `ExceptionNotOpenError`, `BatchReviewRejectedError`
- `app/core/constants.py` — `MAX_BATCH_REVIEW_SIZE`
- `app/db/models/transit.py` — the two claim columns and the server default
- `app/schemas/transit.py` — claim and name fields, `ExceptionClaimRequest`, `TripExceptionBatchReviewRequest`
- `app/orchestration/exception_service.py` — policy import, claim/release, auto-claim, batch, names, severity ordering
- `app/orchestration/{phase_service,scan_service,trip_service,road_check_service,receiver_verification_service,action_location_service}.py` — route through `review_policy`
- `app/orchestration/resource_service.py` — `get_trip_detail(include_reviewer_names=...)`
- `app/api/v1/endpoints/exceptions.py` — 3 new routes, plus the new 409 on review
- `app/api/v1/endpoints/trips.py` — the dispatcher's `GET /trips/{trip_id}` passes `include_reviewer_names=True`
- `app/analytics/fleet/tiles.py` — docstring only
- Tests: `tests/unit/test_realtime_emit.py`, `tests/unit/test_exception_service.py`, plus fallout (Task 2, Step 6)

**Frontend — create**
- `frontend/dispatcher/lib/format/review-state.ts` (+ `.test.ts`)
- `frontend/dispatcher/components/domain/ReviewFields.tsx` — the three review inputs, shared by the detail page and the batch form
- `frontend/dispatcher/components/trips/BatchReviewForm.tsx` (+ `.test.tsx`)

**Frontend — modify**
- `frontend/shared/lib/types/exception.ts`
- `frontend/shared/lib/mocks/*`, wherever `TripException` fixtures are built
- `frontend/dispatcher/lib/realtime/types.ts`
- `frontend/dispatcher/lib/api/client.ts`
- `frontend/dispatcher/lib/hooks/useExceptions.ts`
- `frontend/dispatcher/lib/hooks/useExceptionDetail.ts`
- `frontend/dispatcher/app/(app)/exceptions/page.tsx` (+ test)
- `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx` (+ test)
- `frontend/dispatcher/components/domain/ExceptionSummary.tsx`
- `frontend/dispatcher/components/trips/TripExceptionsPanel.tsx` (+ test)

**Shared files touched (flag in TASK COMPLETE):** none from the CLAUDE.md list. `main.py` is not touched, because the new routes go on the already-registered `dispatcher_router`. Also flag the new migration.

---

### Task 1: Data layer — enums, claim columns, needs_review default, migration

**Files:**
- Modify: `backend/app/db/models/enums.py` (`ExceptionReviewOutcome`, around line 310)
- Modify: `backend/app/core/realtime.py` (`RealtimeKind`, around line 48)
- Modify: `backend/app/db/models/transit.py` (`review_status` around line 234; add columns after `contact_method`)
- Create: `backend/migrations/versions/2026_09_30_ciaran_exception_claims.py`
- Test: `backend/tests/unit/test_review_policy.py` (created here; extended in Task 2)

**Interfaces — produces:**
- `ExceptionReviewOutcome.DISPATCHER_AUTHORED = "dispatcher_authored"`. **Not** added to `DispatcherReviewOutcome`.
- `RealtimeKind.EXCEPTION_CLAIMED = "exception_claimed"`
- `TripException.claimed_by_user_id: Mapped[Optional[uuid.UUID]]`, `TripException.claimed_at: Mapped[Optional[datetime]]`
- Migration revision `ciaran_exception_claims`, down-revision `ciaran_trailer_geofence`

- [ ] **Step 1: Write the failing tests.** Create `backend/tests/unit/test_review_policy.py`:

```python
"""FP-280 — every exception enters the dispatcher review workflow.

DB-backed where the column default is under test: Base.metadata.create_all builds the
test schema from the model, so the model's server_default is what these rows get.
"""

import uuid

from sqlalchemy import select

from app.core.realtime import RealtimeKind
from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
)
from app.db.models.transit import TripException


async def test_exception_without_explicit_status_defaults_to_needs_review(db_session, seeded):
    exc = TripException(
        id=uuid.uuid4(), trip_id=seeded["trip"].id,
        exception_type=ExceptionType.CHECKPOINT_TIMEOUT, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.INFO, description="Raw insert with no review_status",
    )
    db_session.add(exc)
    await db_session.flush()

    stored = (await db_session.execute(
        select(TripException.review_status).where(TripException.id == exc.id)
    )).scalar_one()

    assert stored == ExceptionReviewStatus.NEEDS_REVIEW.value


def test_dispatcher_authored_is_a_marker_not_a_choice():
    assert ExceptionReviewOutcome.DISPATCHER_AUTHORED.value == "dispatcher_authored"
    assert "dispatcher_authored" not in {o.value for o in DispatcherReviewOutcome}


def test_exception_claimed_is_a_realtime_kind():
    assert RealtimeKind.EXCEPTION_CLAIMED.value == "exception_claimed"


async def test_claim_columns_start_empty(db_session, seeded):
    exc = TripException(
        id=uuid.uuid4(), trip_id=seeded["trip"].id,
        exception_type=ExceptionType.CHECKPOINT_TIMEOUT, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.WARNING, description="Unclaimed",
    )
    db_session.add(exc)
    await db_session.flush()
    await db_session.refresh(exc)

    assert exc.claimed_by_user_id is None
    assert exc.claimed_at is None
```

Confirm that `ExceptionType.CHECKPOINT_TIMEOUT` exists in `enums.py` (it is in the frontend union). If it doesn't, use any existing value.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `cd backend && .venv/bin/pytest tests/unit/test_review_policy.py -v`
  Expected: FAIL. You should see `AttributeError` for `DISPATCHER_AUTHORED`, `EXCEPTION_CLAIMED` and `claimed_by_user_id`, and `'recorded' != 'needs_review'`.

- [ ] **Step 3: Implement.**

`enums.py`: add this after `LEGACY_REVIEW` inside `ExceptionReviewOutcome`, and update the class docstring to mention both markers:

```python
    # Not a finding either: marks a dispatcher's own note (phase override, trip
    # cancellation) as reviewed by its author the moment it is written. Only the
    # author knows why they acted, so queueing it would have a colleague rubber-stamp
    # it. Excluded from DispatcherReviewOutcome for the same reason as LEGACY_REVIEW.
    DISPATCHER_AUTHORED    = "dispatcher_authored"
```

`realtime.py`: add this to `RealtimeKind`, after `EXCEPTION_REVIEWED`:

```python
    # Claim, release and take-over share one kind: every screen reacts the same way
    # (silent refetch, never a toast), and the payload stays ids-only either way.
    EXCEPTION_CLAIMED = "exception_claimed"
```

`transit.py`: change the `review_status` default and update the comment above it to say that every exception now starts `needs_review` (FP-280):

```python
    review_status: Mapped[ExceptionReviewStatus] = mapped_column(
        String(20), nullable=False, server_default=ExceptionReviewStatus.NEEDS_REVIEW.value
    )
```

Add after `contact_method`:

```python
    # Who is working this exception right now (FP-280); NULL = nobody. Deliberately not
    # a review_status value of its own: "claimed" is needs_review plus a claimer, so the
    # history filter, the analytics queries and every needs_review count keep their
    # meaning unchanged. Kept after review, so the record shows who took it on as well
    # as who concluded it. The FK is named explicitly to match the migration, because
    # Base has no naming_convention.
    claimed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_exceptions_claimed_by_user_id"), nullable=True
    )
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
```

Create the migration by hand, matching the header style of `2026_09_23_ciaran_trailer_geofence.py`:

```python
"""FP-280: every exception is reviewed — claim columns, needs_review default, backfill.

Adds exceptions.claimed_by_user_id / claimed_at (who is working an exception, and
since when), makes needs_review the column default, and moves every row that was only
ever "recorded" into the review inbox. Reviewed rows are untouched: their review is the
record.

Hand-written, not autogenerated: against this project autogenerate proposes dropping
live indexes and the Supabase auth FKs.

Revision ID: ciaran_exception_claims
Revises: ciaran_trailer_geofence
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa

# Keep revision ids under 32 characters — alembic_version.version_num is varchar(32).
revision = "ciaran_exception_claims"
down_revision = "ciaran_trailer_geofence"
branch_labels = None
depends_on = None

_TABLE = "exceptions"
_CLAIMED_BY_FK = "fk_exceptions_claimed_by_user_id"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("claimed_by_user_id", sa.UUID(), nullable=True))
    op.add_column(_TABLE, sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(_CLAIMED_BY_FK, _TABLE, "users", ["claimed_by_user_id"], ["id"])
    # A future write site or seed script that omits review_status must still land in
    # the inbox: the default is the last line of defence for "nothing is silently recorded".
    op.alter_column(_TABLE, "review_status", server_default="needs_review")
    op.execute("UPDATE exceptions SET review_status = 'needs_review' WHERE review_status = 'recorded'")


def downgrade() -> None:
    # Author-reviewed notes did not exist before this revision; return them to the
    # pre-FP-280 shape (a recorded dispatcher note with no review).
    op.execute(
        "UPDATE exceptions SET review_status = 'recorded', review_outcome = NULL, "
        "reviewed_by_user_id = NULL, reviewed_at = NULL "
        "WHERE review_outcome = 'dispatcher_authored'"
    )
    # Lossy by necessity: the backfill cannot tell a warning that was already
    # needs_review from one this revision moved, so every unreviewed non-critical row
    # returns to 'recorded' — which is exactly the pre-FP-280 policy.
    op.execute(
        "UPDATE exceptions SET review_status = 'recorded' "
        "WHERE review_status = 'needs_review' AND severity <> 'critical'"
    )
    op.alter_column(_TABLE, "review_status", server_default="recorded")
    op.drop_constraint(_CLAIMED_BY_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "claimed_at")
    op.drop_column(_TABLE, "claimed_by_user_id")
```

- [ ] **Step 4: Run the tests and confirm they pass, then verify the migration file.**
  Run: `cd backend && .venv/bin/pytest tests/unit/test_review_policy.py -v`. Expected: 4 PASS.
  Run: `cd backend && .venv/bin/alembic heads`. Expected: one line, `ciaran_exception_claims (head)`.
  Run: `grep -nE "op\.[a-z_]+\(" backend/migrations/versions/2026_09_30_ciaran_exception_claims.py`. Expected: exactly the ops above, and nothing else.
  **Do not run `alembic upgrade`.**

- [ ] **Step 5: Stage.** Run `git add` on the five files. Suggested commit: `feat(db): add exception claim columns and default every exception to needs_review`

---

### Task 2: One review policy at every write site, including dispatcher-authored notes

**Files:**
- Create: `backend/app/orchestration/review_policy.py`
- Modify: `backend/app/orchestration/exception_service.py`. Delete `initial_review_status` (lines 110–122) and import it from `review_policy` instead.
- Modify: `backend/app/orchestration/phase_service.py`:
  - delete the `_initial_review_status` wrapper (lines 131–145)
  - import at module top
  - rename every call from `_initial_review_status(` to `initial_review_status(`
  - make the override `DISPATCHER_NOTE` (around line 1045) use `**dispatcher_authored_review(...)`
- Modify: `backend/app/orchestration/scan_service.py`. Delete the `_initial_review_status` wrapper (lines 49–62), import at module top, and rename the one call.
- Modify: `backend/app/orchestration/trip_service.py`. Change the import source. The cancel `DISPATCHER_NOTE` (around line 569) uses `**dispatcher_authored_review(user_id=user_id, at=trip.closed_at)`.
- Modify: `backend/app/orchestration/road_check_service.py` and `receiver_verification_service.py`. Change the import source only.
- Modify: `backend/app/orchestration/action_location_service.py`. Replace the two hard-coded `review_status=ExceptionReviewStatus.NEEDS_REVIEW` (around lines 525 and 655) with `review_status=initial_review_status(<the severity passed to that same constructor>)`, and rewrite the docstrings around lines 466 and 615 that explain the old "forced" value.
- Modify: `backend/app/analytics/fleet/tiles.py`. Docstring of `critical_waiting` only. It currently says only critical exceptions enter the queue on their own; now every exception does, and the severity filter is what keeps this a "must act on" count.
- Test: `backend/tests/unit/test_review_policy.py` (extend), `backend/tests/unit/test_realtime_emit.py` (rewrite the invariant test), `backend/tests/unit/test_exception_service.py` (fix the import and the policy tests)

**Interfaces:**
- Consumes: Task 1 enums and columns.
- Produces:
  - `review_policy.initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus`
  - `review_policy.dispatcher_authored_review(*, user_id: uuid.UUID, at: datetime) -> AuthoredReviewFields` (a `TypedDict` with keys `review_status`, `review_outcome`, `reviewed_by_user_id`, `reviewed_at`, `claimed_by_user_id`, `claimed_at`)

- [ ] **Step 1: Write the failing tests.**

Append to `tests/unit/test_review_policy.py`:

```python
from datetime import UTC, datetime

import pytest

from app.orchestration.review_policy import dispatcher_authored_review, initial_review_status


@pytest.mark.parametrize("severity", list(ExceptionSeverity))
def test_every_severity_starts_needs_review(severity):
    assert initial_review_status(severity) is ExceptionReviewStatus.NEEDS_REVIEW


def test_dispatcher_authored_review_names_the_author_as_claimer_and_reviewer():
    author = uuid.uuid4()
    at = datetime.now(UTC)

    fields = dispatcher_authored_review(user_id=author, at=at)

    assert fields == {
        "review_status": ExceptionReviewStatus.REVIEWED,
        "review_outcome": ExceptionReviewOutcome.DISPATCHER_AUTHORED,
        "reviewed_by_user_id": author,
        "reviewed_at": at,
        "claimed_by_user_id": author,
        "claimed_at": at,
    }
```

In `tests/unit/test_realtime_emit.py`, replace `test_every_trip_exception_write_site_is_accounted_for` (starting around line 745) with the version below. Keep its docstring and add this paragraph to it: "FP-280: scans every file under app/ rather than a fixed list, because the fixed list had silently missed three files."

```python
def test_every_trip_exception_write_site_is_accounted_for():
    """(keep the existing docstring, plus the FP-280 paragraph above)"""
    root = pathlib.Path(__file__).resolve().parents[2]
    constructor = re.compile(r"\bTripException\(")
    actual = {
        path.relative_to(root).as_posix(): len(constructor.findall(path.read_text()))
        for path in sorted((root / "app").rglob("*.py"))
        # The model's own `class TripException(Base):` matches the pattern; it is the
        # definition, not a write.
        if "app/db/models/" not in path.as_posix()
    }
    actual = {path: count for path, count in actual.items() if count}

    expected_sites = {
        "app/orchestration/action_location_service.py": 2,
        "app/orchestration/exception_service.py": 1,
        "app/orchestration/phase_service.py": 8,
        "app/orchestration/receiver_verification_service.py": 1,
        "app/orchestration/road_check_service.py": 1,
        "app/orchestration/scan_service.py": 1,
        "app/orchestration/trip_service.py": 1,
    }
    assert actual == expected_sites, (
        "A TripException write site was added or removed. Every site must enqueue a "
        "realtime event and route its review state through review_policy."
    )

    # FP-280: every site decides its review state through review_policy — either the
    # inbox (initial_review_status) or, for a dispatcher's own note, author-reviewed
    # (dispatcher_authored_review). A site that hard-codes a status, or relies on the
    # column default, is one the next policy change breaks silently.
    routing = re.compile(r"review_status=initial_review_status\(|\*\*dispatcher_authored_review\(")
    routed = {path: len(routing.findall((root / path).read_text())) for path in expected_sites}
    assert routed == expected_sites, (
        "Every TripException construction must route its review state through "
        "review_policy (initial_review_status or dispatcher_authored_review)."
    )
```

Also add integration assertions in the existing test modules that cover cancel and override. Find them with `grep -rln "cancel\|override" backend/tests/integration/test_trip_admin.py backend/tests/integration/test_phases*.py`, then add one test to each:

```python
async def test_cancel_note_is_reviewed_by_its_author(client, db_session, <that module's fixtures>):
    # Arrange: an active trip and a dispatcher token (reuse the module's helpers).
    # Act: POST /api/v1/trips/{trip_id}/cancel with {"note": "Client withdrew the load."}
    # Assert against the DB:
    note = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.DISPATCHER_NOTE,
        )
    )).scalar_one()
    assert note.review_status == ExceptionReviewStatus.REVIEWED
    assert note.review_outcome == ExceptionReviewOutcome.DISPATCHER_AUTHORED
    assert note.reviewed_by_user_id == dispatcher.id
    assert note.claimed_by_user_id == dispatcher.id
    assert note.reviewed_at == note.claimed_at
```

Write the equivalent `test_override_note_is_reviewed_by_its_author`, and also assert there that the arrival override's `SEAL_UNVERIFIED` row (if the fixture overrides arrival) is `NEEDS_REVIEW`. Use the module's real fixture names and URL helpers. Read the module first.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `cd backend && .venv/bin/pytest tests/unit/test_review_policy.py tests/unit/test_realtime_emit.py -k "severity or authored or write_site" -v`
  Expected: FAIL. `review_policy` doesn't exist yet, and the write-site dict mismatches for the three unlisted files.

- [ ] **Step 3: Implement `review_policy.py`.**

```python
"""How every exception enters the dispatcher review workflow (FP-280).

A leaf module — it imports nothing from app.orchestration — so every service that
writes a TripException imports it at module scope. The rule used to live in
exception_service, which phase_service and scan_service could only reach through
lazy-import wrappers (exception_service imports phase_service at load time), and
action_location_service not at all, so it hard-coded its own value. One rule that
three files cannot import cleanly is a rule the next write site skips.
"""

import uuid
from datetime import datetime
from typing import TypedDict

from app.db.models.enums import ExceptionReviewOutcome, ExceptionReviewStatus, ExceptionSeverity


def initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:
    """Every exception starts unreviewed, whatever its severity (team decision,
    29 Sep 2026): nothing is recorded and forgotten. Severity decides the order the
    inbox is worked in and whether batch review is allowed — not whether a human looks.

    `severity` stays a parameter so the policy table planned in the exception-workflow
    spec can vary this without touching every write site again.
    """
    return ExceptionReviewStatus.NEEDS_REVIEW


class AuthoredReviewFields(TypedDict):
    review_status: ExceptionReviewStatus
    review_outcome: ExceptionReviewOutcome
    reviewed_by_user_id: uuid.UUID
    reviewed_at: datetime
    claimed_by_user_id: uuid.UUID
    claimed_at: datetime


def dispatcher_authored_review(*, user_id: uuid.UUID, at: datetime) -> AuthoredReviewFields:
    """Review fields for a note a dispatcher writes as part of their own action (phase
    override, trip cancellation), spread into the TripException constructor with `**`.

    The author is the reviewer: nobody else can add to "why I did this". Claimer and
    reviewer are the same person at the same instant, so an authored note reads like
    any other reviewed row — who took it on, who concluded it, when.
    """
    return AuthoredReviewFields(
        review_status=ExceptionReviewStatus.REVIEWED,
        review_outcome=ExceptionReviewOutcome.DISPATCHER_AUTHORED,
        reviewed_by_user_id=user_id,
        reviewed_at=at,
        claimed_by_user_id=user_id,
        claimed_at=at,
    )
```

If ruff flags the unused `severity` argument (ARG001), add `# noqa: ARG001` on the `def` line. The docstring already says why the argument is kept.

- [ ] **Step 4: Rewire the write sites.** Work through the Files list above.
  - Override site in `phase_service.py`: replace `review_status=initial_review_status(ExceptionSeverity.WARNING),` with `**dispatcher_authored_review(user_id=user_id, at=datetime.now(UTC)),`. `datetime` and `UTC` are already imported.
  - Cancel site in `trip_service.py`: use `**dispatcher_authored_review(user_id=user_id, at=trip.closed_at),`, so the note carries the same instant as the closure. Keep the existing comment block, and add one line: "Reviewed by its author at creation (FP-280) — see review_policy."
  - Update the docstring of `_driver_report_assessment` and any other comment that says "CRITICAL starts NEEDS_REVIEW, everything else RECORDED". Run `grep -rn "RECORDED" backend/app/orchestration/` and fix every comment that describes the old policy.

- [ ] **Step 5: Run the targeted tests and confirm they pass.**
  Run: `cd backend && .venv/bin/pytest tests/unit/test_review_policy.py tests/unit/test_realtime_emit.py -v`. Expected: PASS.

- [ ] **Step 6: Fix fallout from the policy change.**
  Run: `cd backend && .venv/bin/pytest -m "not slow" -x -q` (foreground). Repeat until green. For each failure:
  - The test asserts the **old policy** (a warning or info row expected to be `RECORDED`, or a count that excluded warnings). Update the expectation to `NEEDS_REVIEW` or the new count, and add a one-line comment: `# FP-280: every exception starts needs_review.`
  - A **seed built a row without `review_status`** and a *history* test expected it to be `recorded`. Set `review_status=ExceptionReviewStatus.RECORDED` (or `REVIEWED`) explicitly in the seed, because history deliberately excludes `needs_review`.
  - `tests/unit/test_exception_service.py` imports `initial_review_status` from `exception_service`. Change it to `from app.orchestration.review_policy import initial_review_status`, and delete or merge any old severity→status test into the parametrized one from Step 1.
  - **Never** delete an assertion to get a pass, and never weaken an org-scoping or 409 test. If a failure doesn't fit either case above, stop and report it.
  - Files known to reference the old values: `test_exception_service.py`, `test_exceptions_dispatcher.py`, `test_exception_reads.py`, `test_exception_review_concurrency.py`, `test_gps_mismatch.py`, `test_locations.py`, `_fleet_seed.py`, `test_scan_service.py`, `test_phase_service.py`, `test_fleet_review.py`, `test_analytics.py`.

- [ ] **Step 7: Gates.** In `backend/`, run `.venv/bin/ruff check . && .venv/bin/mypy . && .venv/bin/pytest -m "not slow"`. All must be green.

- [ ] **Step 8: Stage.** Suggested commit: `feat(orchestration): route every exception write through one review policy; dispatcher notes are author-reviewed`

---

### Task 3: Claim, release, take over, auto-claim on review, names, severity ordering

**Files:**
- Create: `backend/app/orchestration/review_identity.py`
- Modify:
  - `backend/app/core/exceptions.py`
  - `backend/app/schemas/transit.py`
  - `backend/app/orchestration/exception_service.py`
  - `backend/app/orchestration/resource_service.py`
  - `backend/app/api/v1/endpoints/exceptions.py`
  - `backend/app/api/v1/endpoints/trips.py`, only the dispatcher `get_trip_detail_endpoint` around line 245
- Test:
  - `backend/tests/integration/test_exception_claims.py` (new)
  - `backend/tests/unit/test_exception_service.py`, for the emit tests (it has the `_seed`, `_review` and `_outbox` helpers)

**Interfaces:**
- Consumes: Task 1 columns and `RealtimeKind.EXCEPTION_CLAIMED`.
- Produces:
  - `ExceptionClaimedByColleagueError(exception_id: str)`, `ExceptionNotOpenError(exception_id: str)`, `BatchReviewRejectedError(reason: str)` in `app/core/exceptions.py`.
  - `review_identity.user_names(db, *, organization_id: UUID, user_ids: Iterable[UUID | None]) -> dict[UUID, str]`
  - `review_identity.name_of(names: Mapping[UUID, str], user_id: UUID | None) -> str | None`
  - `review_identity.with_reviewer_names(db, *, organization_id: UUID, reads: Sequence[TripExceptionRead]) -> list[TripExceptionRead]`
  - `exception_service.claim_exception(db, *, exception_id, user_id, organization_id, take_over: bool) -> TripExceptionRead`
  - `exception_service.release_exception(db, *, exception_id, user_id, organization_id) -> TripExceptionRead`
  - `exception_service._lock_for_review(db, *, exception_id, organization_id) -> tuple[TripException, Trip]`, used by Task 4's single-row paths.
  - `exception_service._read_with_names(db, exc, trip) -> TripExceptionRead`
  - `resource_service.get_trip_detail(db, trip_id, operator_organization_id, *, include_reviewer_names: bool = False)`
  - HTTP:
    - `POST /api/v1/exceptions/{id}/claim`, body `{"take_over": bool}` (default false) → 200 `TripExceptionRead`
    - `DELETE /api/v1/exceptions/{id}/claim` → 200 `TripExceptionRead`
    - Both return 404 for a missing or cross-org id, and 409 for a colleague's claim (claim without `take_over`; release) or an already-reviewed row.
    - `PATCH .../review` body gains an optional `take_over: bool = false`. It returns 409 when a colleague holds the claim and `take_over` is false; with `take_over: true` the reviewer takes over and reviews in one step.
  - `exception_service.review_exception(..., take_over: bool = False)`: a new keyword parameter; existing callers are unchanged.
  - New response fields on `TripExceptionRead`, `TripExceptionListItem` and `TripExceptionDetail`: `claimed_by_user_id`, `claimed_at`, `claimed_by_name`, `reviewed_by_name` (all Optional, default None).
  - `GET /exceptions/review-queue` is ordered critical → warning → info, then `created_at` desc, then `id` desc.

- [ ] **Step 1: Write the failing integration tests.** Create `backend/tests/integration/test_exception_claims.py`. Copy the imports, the `override_get_db` autouse fixture, `_seed_org_with_exception`, `_headers` and `_body` from `tests/integration/test_exceptions_dispatcher.py` lines 1–130. Test-module helpers are duplicated per module by convention here; see its `two_orgs`. Then add a second dispatcher in the same org, and the tests:

```python
def _claim_url(exception_id: uuid.UUID) -> str:
    return f"/api/v1/exceptions/{exception_id}/claim"


async def _colleague(db_session, org) -> User:
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"colleague-{uuid.uuid4().hex[:6]}@test.co.za", full_name="Colleague Ana",
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _headers_for(user: User, org) -> dict:
    return auth_header(make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id)))


async def test_claim_records_claimer_and_time(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert res.status_code == 200
    body = res.json()
    assert body["claimed_by_user_id"] == str(mine["user"].id)
    assert body["claimed_by_name"] == mine["user"].full_name
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id
    assert mine["exception"].claimed_at is not None
    assert mine["exception"].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_reclaim_by_same_dispatcher_is_idempotent(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    first = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    second = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert second.status_code == 200
    assert second.json()["claimed_at"] == first.json()["claimed_at"]


async def test_claim_over_a_colleague_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_take_over_replaces_a_colleagues_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={"take_over": True}, headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_release_by_claimer_clears_the_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id is None
    assert mine["exception"].claimed_at is None


async def test_release_of_a_colleagues_claim_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_release_of_an_unclaimed_row_is_a_no_op(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 200
    assert res.json()["claimed_by_user_id"] is None


async def test_release_after_review_is_409_and_keeps_the_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_claim_of_a_reviewed_row_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={"take_over": True}, headers=_headers(mine))

    assert res.status_code == 409


async def test_claim_across_organisations_is_404(client, two_orgs):
    res = await client.post(
        _claim_url(two_orgs["theirs"]["exception"].id), json={}, headers=_headers(two_orgs["mine"]),
    )

    assert res.status_code == 404


async def test_claim_without_credentials_is_403(client, two_orgs):
    res = await client.post(_claim_url(two_orgs["mine"]["exception"].id), json={})

    assert res.status_code == 403


async def test_claim_with_malformed_id_is_422(client, two_orgs):
    res = await client.post("/api/v1/exceptions/not-a-uuid/claim", json={}, headers=_headers(two_orgs["mine"]))

    assert res.status_code == 422


async def test_review_of_an_unclaimed_row_auto_claims_it(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.claimed_by_user_id == mine["user"].id
    assert exc.claimed_at == exc.reviewed_at
    assert res.json()["reviewed_by_name"] == mine["user"].full_name


async def test_review_over_a_colleagues_claim_is_409_and_changes_nothing(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_status == ExceptionReviewStatus.NEEDS_REVIEW
    assert mine["exception"].review_note is None
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_take_over_and_review_in_one_step(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(take_over=True), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.review_status == ExceptionReviewStatus.REVIEWED
    assert exc.reviewed_by_user_id == mine["user"].id
    assert exc.claimed_by_user_id == mine["user"].id
    assert exc.claimed_at == exc.reviewed_at


async def test_review_with_take_over_on_an_unclaimed_row_just_reviews(client, db_session, two_orgs):
    """take_over on a row nobody holds is harmless — a stale 'Take over and review'
    button must not fail just because the colleague released in the meantime."""
    mine = two_orgs["mine"]

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(take_over=True), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_review_queue_is_ordered_by_severity_then_newest(client, db_session, two_orgs):
    mine = two_orgs["mine"]  # its seeded exception is CRITICAL
    for severity in (ExceptionSeverity.INFO, ExceptionSeverity.WARNING):
        db_session.add(TripException(
            id=uuid.uuid4(), trip_id=mine["trip"].id, exception_type=ExceptionType.CHECKPOINT_TIMEOUT,
            source=ExceptionSource.SYSTEM, severity=severity, description=f"{severity.value} row",
        ))
    await db_session.flush()

    res = await client.get("/api/v1/exceptions/review-queue", headers=_headers(mine))

    assert [row["severity"] for row in res.json()] == ["critical", "warning", "info"]


async def test_review_queue_rows_carry_the_claimers_name(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    res = await client.get("/api/v1/exceptions/review-queue", headers=_headers(mine))

    assert res.json()[0]["claimed_by_name"] == mine["user"].full_name


async def test_trip_detail_omits_reviewer_names_unless_asked(db_session, two_orgs):
    from app.orchestration.resource_service import get_trip_detail
    mine = two_orgs["mine"]
    mine["exception"].claimed_by_user_id = mine["user"].id
    await db_session.flush()

    driver_view = await get_trip_detail(db_session, mine["trip"].id, mine["org"].id)
    dispatcher_view = await get_trip_detail(
        db_session, mine["trip"].id, mine["org"].id, include_reviewer_names=True,
    )

    assert driver_view.exceptions[0].claimed_by_name is None
    assert dispatcher_view.exceptions[0].claimed_by_name == mine["user"].full_name
```

Note: `_seed_org_with_exception` builds its exception without `review_status`. After Task 1 that means `needs_review`, which is what these tests need. Also use `_review_url` from the copied helpers.

In `tests/unit/test_exception_service.py`, add emit tests next to `test_review_enqueues_an_info_event`, using the existing `_seed` and `_outbox`:

```python
async def test_claim_enqueues_an_info_claimed_event(db_session):
    seed = await _seed(db_session, tag="claim-emit")

    await claim_exception(
        db_session, exception_id=seed["exception"].id, user_id=seed["user"].id,
        organization_id=seed["org"].id, take_over=False,
    )

    [(org_id, event)] = _outbox(db_session)
    assert org_id == seed["org"].id
    assert event.kind is RealtimeKind.EXCEPTION_CLAIMED
    assert event.severity is EventSeverity.INFO


async def test_idempotent_reclaim_enqueues_nothing(db_session):
    seed = await _seed(db_session, tag="reclaim-emit")
    kwargs = dict(exception_id=seed["exception"].id, user_id=seed["user"].id,
                  organization_id=seed["org"].id, take_over=False)
    await claim_exception(db_session, **kwargs)
    _outbox(db_session).clear()

    await claim_exception(db_session, **kwargs)

    assert _outbox(db_session) == []
```

Add `claim_exception` to that module's import from `exception_service`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_claims.py tests/unit/test_exception_service.py -k "claim or release or auto_claim or colleague or ordered or names" -v`
  Expected: FAIL. The routes return 404/405, and the new fields and functions are missing.

- [ ] **Step 3: Add the error classes** to `app/core/exceptions.py`, next to `ExceptionAlreadyReviewedError`:

```python
class ExceptionClaimedByColleagueError(Exception):
    """Raised when a request meets a colleague's claim without saying it means to take over.

    Not a lock — anyone may take over, by claiming or reviewing with take_over=True. This
    only refuses the *silent* override: a page loaded before the colleague claimed would
    otherwise replace their claim without the dispatcher ever seeing it existed.
    """

    def __init__(self, exception_id: str) -> None:
        super().__init__(
            f"Exception '{exception_id}' is claimed by another dispatcher. "
            "Take it over before acting on it."
        )


class ExceptionNotOpenError(Exception):
    """Raised when claiming or releasing an exception that is already reviewed — by
    then, who claimed it is part of the record, not a work assignment."""

    def __init__(self, exception_id: str) -> None:
        super().__init__(f"Exception '{exception_id}' is already reviewed; its claim can no longer change.")


class BatchReviewRejectedError(Exception):
    """A batch review that breaks a batch rule (a critical row, rows from another trip).
    422, not 409: nothing changed underneath the caller — the request itself is not a
    reviewable batch."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
```

- [ ] **Step 4: Add the schema fields.** In `app/schemas/transit.py`, add this block to **both** `TripExceptionListItem` (after `action_location_assessment`) and `TripExceptionRead` (after `contact_method`):

```python
    # Claim (FP-280): who is working this exception, and since when. None = unclaimed.
    claimed_by_user_id: Optional[UUID] = None
    claimed_at: Optional[datetime] = None
    # Display names for claimer and reviewer, resolved server-side from users.full_name
    # within the caller's own organisation. Always None on driver-facing responses: a
    # driver has no review action and no need for dispatcher identities.
    claimed_by_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None
```

Add the request model after `TripExceptionReviewRequest`:

```python
class ExceptionClaimRequest(BaseModel):
    """Claim an exception. take_over must be explicit: replacing a colleague's claim is a
    deliberate act, so the default can only ever claim something nobody holds."""

    take_over: bool = False
```

Add the same field to `TripExceptionReviewRequest`, after `contact_method`, and add one sentence to its docstring: "`take_over` lets a dispatcher take over a colleague's claim and review in one step (FP-280 soft claim); false by default, so a stale page never overrides a claim it didn't show."

```python
    take_over: bool = False
```

- [ ] **Step 5: Create `app/orchestration/review_identity.py`.**

```python
"""Display names for the dispatchers who claimed and reviewed an exception (FP-280).

A leaf module (no other orchestration imports) so exception_service and
resource_service can both use it: resource_service cannot import exception_service,
which imports phase_service, which imports resource_service.

Scoped to the caller's organisation, like every read here: a user id from anywhere
else resolves to no name rather than to another operator's staff member.
"""

import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.people import User
from app.schemas.transit import TripExceptionRead


async def user_names(
    db: AsyncSession, *, organization_id: uuid.UUID, user_ids: Iterable[uuid.UUID | None],
) -> dict[uuid.UUID, str]:
    ids = {user_id for user_id in user_ids if user_id is not None}
    if not ids:
        return {}
    rows = await db.execute(
        select(User.id, User.full_name).where(User.id.in_(ids), User.organization_id == organization_id)
    )
    return {user_id: name for user_id, name in rows.tuples().all()}


def name_of(names: Mapping[uuid.UUID, str], user_id: uuid.UUID | None) -> str | None:
    return None if user_id is None else names.get(user_id)


async def with_reviewer_names(
    db: AsyncSession, *, organization_id: uuid.UUID, reads: Sequence[TripExceptionRead],
) -> list[TripExceptionRead]:
    """One query for the whole list, not one per row."""
    names = await user_names(
        db, organization_id=organization_id,
        user_ids=[uid for read in reads for uid in (read.claimed_by_user_id, read.reviewed_by_user_id)],
    )
    return [
        read.model_copy(update={
            "claimed_by_name": name_of(names, read.claimed_by_user_id),
            "reviewed_by_name": name_of(names, read.reviewed_by_user_id),
        })
        for read in reads
    ]
```

- [ ] **Step 6: Change `exception_service.py`.**
  1. **Imports:** add `case`; `ExceptionClaimedByColleagueError` and `ExceptionNotOpenError`; `from app.orchestration.review_identity import name_of, user_names, with_reviewer_names`; and `from collections.abc import Mapping`.
  2. **Extract the lock** from `review_exception` into `_lock_for_review`. Move the existing long comment about `with_for_update(of=TripException)` onto the helper, word for word, and add: "Shared by review, claim and release: all three decide based on the current claim, so all three must hold the row."

  ```python
  async def _lock_for_review(
      db: AsyncSession, *, exception_id: uuid.UUID, organization_id: uuid.UUID,
  ) -> tuple[TripException, Trip]:
      row = (await db.execute(
          select(TripException, Trip)
          .join(Trip, Trip.id == TripException.trip_id)
          .where(TripException.id == exception_id, Trip.operator_organization_id == organization_id)
          .with_for_update(of=TripException)
      )).one_or_none()
      if row is None:
          raise ResourceNotFoundError("TripException", str(exception_id))
      return row[0], row[1]


  async def _read_with_names(db: AsyncSession, exc: TripException, trip: Trip) -> TripExceptionRead:
      """Dispatcher-facing read. raise_exception (driver-facing) keeps _read_with_trip
      and gets no names by design."""
      [read] = await with_reviewer_names(
          db, organization_id=trip.operator_organization_id, reads=[_read_with_trip(exc, trip)],
      )
      return read


  def _enqueue_claim_changed(db: AsyncSession, trip: Trip, exc: TripException) -> None:
      # INFO: a claim is coordination, not an alarm — it refreshes colleagues' screens
      # without interrupting anyone.
      enqueue_event(db, trip.operator_organization_id, TripEvent(
          id=exc.trip_id, kind=RealtimeKind.EXCEPTION_CLAIMED,
          severity=event_severity(ExceptionSeverity.INFO),
      ))
  ```

  3. **In `review_exception`:** add a keyword parameter `take_over: bool = False` after `contact_method`. Replace the inline query with `exc, trip = await _lock_for_review(...)`. Keep the whole REVIEWED branch as it is. Then insert this before `exc.review_status = ExceptionReviewStatus.REVIEWED`:

  ```python
      previous_claimer = exc.claimed_by_user_id
      if previous_claimer is not None and previous_claimer != user_id and not take_over:
          # A colleague claimed it, and this request didn't say it means to take over —
          # the page was loaded before their claim. Refuse rather than silently replace
          # it; the dispatcher can resubmit as "Take over and review".
          raise ExceptionClaimedByColleagueError(str(exception_id))
      now = datetime.now(UTC)
      if previous_claimer != user_id:
          # Auto-claim (unclaimed) or take over (a colleague's claim), inside the same
          # locked transaction: no instant exists at which anyone else could claim
          # between this and the review below, and every reviewed row names who took it on.
          exc.claimed_by_user_id = user_id
          exc.claimed_at = now
          if previous_claimer is not None:
              logger.info(
                  "Exception taken over at review: exception=%s from=%s by=%s",
                  exception_id, previous_claimer, user_id,
              )
  ```

  Change `exc.reviewed_at = datetime.now(UTC)` to `exc.reviewed_at = now`. Change both `return _read_with_trip(exc, trip)` lines in `review_exception` to `return await _read_with_names(db, exc, trip)`. Update the docstring: add a paragraph on the soft claim ("auto-claims an unclaimed row; take_over=True takes a colleague's claim in the same step; without it a colleague's claim is a 409"), and add `ExceptionClaimedByColleagueError` to its "Raises:" list.

  4. **Add `claim_exception` and `release_exception`** after `review_exception`:

  ```python
  async def claim_exception(
      db: AsyncSession, *, exception_id: uuid.UUID, user_id: uuid.UUID,
      organization_id: uuid.UUID, take_over: bool,
  ) -> TripExceptionRead:
      """Record that this dispatcher is working an unreviewed exception.

      Soft claim: anyone may take over, but only by saying so — a colleague's claim is
      a 409 unless take_over is set, so a stale page never replaces a claim it didn't
      show. A take-over is logged with both parties so the handover is traceable. Re-claiming your own
      claim is idempotent (no write, no event). A reviewed exception cannot be claimed:
      its claimer is part of the record by then.

      Raises:
          ResourceNotFoundError: no such exception in this organisation (-> 404).
          ExceptionNotOpenError: already reviewed (-> 409).
          ExceptionClaimedByColleagueError: a colleague holds it and take_over is False (-> 409).
      """
      exc, trip = await _lock_for_review(db, exception_id=exception_id, organization_id=organization_id)
      if exc.review_status == ExceptionReviewStatus.REVIEWED:
          raise ExceptionNotOpenError(str(exception_id))
      if exc.claimed_by_user_id == user_id:
          return await _read_with_names(db, exc, trip)
      previous = exc.claimed_by_user_id
      if previous is not None and not take_over:
          raise ExceptionClaimedByColleagueError(str(exception_id))

      exc.claimed_by_user_id = user_id
      exc.claimed_at = datetime.now(UTC)
      await db.flush()
      await db.refresh(exc)
      logger.info(
          "Exception claimed: exception=%s trip=%s by=%s taken_over_from=%s",
          exception_id, exc.trip_id, user_id, previous,
      )
      _enqueue_claim_changed(db, trip, exc)
      return await _read_with_names(db, exc, trip)


  async def release_exception(
      db: AsyncSession, *, exception_id: uuid.UUID, user_id: uuid.UUID, organization_id: uuid.UUID,
  ) -> TripExceptionRead:
      """Give an unreviewed exception back to the inbox. Only the claimer may release;
      anyone else takes over instead, so a release never silently drops a colleague's
      claim. Releasing an unclaimed row is a no-op, so a double-tap is harmless.

      Raises:
          ResourceNotFoundError: no such exception in this organisation (-> 404).
          ExceptionNotOpenError: already reviewed (-> 409).
          ExceptionClaimedByColleagueError: a colleague holds it (-> 409).
      """
      exc, trip = await _lock_for_review(db, exception_id=exception_id, organization_id=organization_id)
      if exc.review_status == ExceptionReviewStatus.REVIEWED:
          raise ExceptionNotOpenError(str(exception_id))
      if exc.claimed_by_user_id is None:
          return await _read_with_names(db, exc, trip)
      if exc.claimed_by_user_id != user_id:
          raise ExceptionClaimedByColleagueError(str(exception_id))

      exc.claimed_by_user_id = None
      exc.claimed_at = None
      await db.flush()
      await db.refresh(exc)
      logger.info("Exception released: exception=%s trip=%s by=%s", exception_id, exc.trip_id, user_id)
      _enqueue_claim_changed(db, trip, exc)
      return await _read_with_names(db, exc, trip)
  ```

  5. **Names on list rows.** Change `_to_list_item` to take `names: Mapping[uuid.UUID, str]` as a fifth parameter, and add these to the constructor:

  ```python
          claimed_by_user_id=exc.claimed_by_user_id,
          claimed_at=exc.claimed_at,
          claimed_by_name=name_of(names, exc.claimed_by_user_id),
          reviewed_by_name=name_of(names, exc.reviewed_by_user_id),
  ```

  In `list_review_queue`, `list_exception_history` and `get_exception_detail`, compute the names once from the fetched rows and pass them in:

  ```python
      names = await user_names(
          db, organization_id=organization_id,
          user_ids=[uid for exc, *_ in rows for uid in (exc.claimed_by_user_id, exc.reviewed_by_user_id)],
      )
  ```

  (For `get_exception_detail` it is one row: `user_ids=[exc.claimed_by_user_id, exc.reviewed_by_user_id]`.) `TripExceptionDetail(**list_item.model_dump(), ...)` then carries the names automatically.

  6. **Severity ordering.** Add a module constant and use it in `list_review_queue` only. Update that function's docstring to "critical first, then warning, then info; newest first within a severity".

  ```python
  # The inbox is worked top to bottom, so the most urgent row must be on top. Ordered in
  # SQL, not by the client, so every dispatcher sees the same order.
  _SEVERITY_RANK = case(
      (TripException.severity == ExceptionSeverity.CRITICAL, 0),
      (TripException.severity == ExceptionSeverity.WARNING, 1),
      else_=2,
  )
  ```

  `.order_by(_SEVERITY_RANK, TripException.created_at.desc(), TripException.id.desc())`

- [ ] **Step 7: Change `resource_service.get_trip_detail`.** Add a keyword-only `include_reviewer_names: bool = False` parameter, and build the exceptions like this:

```python
    exception_reads = [TripExceptionRead.model_validate(e) for e in exceptions]
    if include_reviewer_names:
        # Dispatcher trip page only. The same builder serves the driver's active trip
        # and phase completion, which must not carry dispatcher identities.
        exception_reads = await with_reviewer_names(
            db, organization_id=operator_organization_id, reads=exception_reads,
        )
```

Pass `exceptions=exception_reads`. Import `with_reviewer_names` from `app.orchestration.review_identity`. In `api/v1/endpoints/trips.py`, `get_trip_detail_endpoint` (the one guarded by `get_current_dispatcher`, around line 245) passes `include_reviewer_names=True`. **No other call site changes.**

- [ ] **Step 8: Add the routes** in `api/v1/endpoints/exceptions.py`, after the review route. Add the new names to the imports.

```python
@dispatcher_router.post("/{exception_id}/claim", response_model=TripExceptionRead,
                        dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def claim_exception_endpoint(
    exception_id: UUID,
    payload: ExceptionClaimRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionRead:
    """Claim an unreviewed exception, or take it over from a colleague (take_over=true)."""
    try:
        return await claim_exception(
            db, exception_id=exception_id, user_id=current_user.id,
            organization_id=current_user.organization_id, take_over=payload.take_over,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ExceptionClaimedByColleagueError, ExceptionNotOpenError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@dispatcher_router.delete("/{exception_id}/claim", response_model=TripExceptionRead,
                          dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def release_exception_endpoint(
    exception_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionRead:
    """Release your claim, returning the exception to the unreviewed inbox."""
    try:
        return await release_exception(
            db, exception_id=exception_id, user_id=current_user.id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ExceptionClaimedByColleagueError, ExceptionNotOpenError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

In `review_exception_endpoint`, pass `take_over=payload.take_over` to `review_exception`. Then add another `except ExceptionClaimedByColleagueError as exc:` that raises a 409 with `detail=str(exc)`. The error's message names no person, which matches the existing 409's rule.

- [ ] **Step 9: Run the tests and confirm they pass.**
  Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_claims.py tests/unit/test_exception_service.py tests/integration/test_exceptions_dispatcher.py tests/integration/test_exception_reads.py -v`
  Expected: PASS.

- [ ] **Step 10: Gates.** In `backend/`: `.venv/bin/ruff check . && .venv/bin/mypy . && .venv/bin/pytest -m "not slow"` — all green.

- [ ] **Step 11: Stage.** Suggested commit: `feat(api): claim, release and take over exceptions; reviewing auto-claims; queue ordered by severity`

---

### Task 4: Per-trip batch review of non-critical exceptions

**Files:**
- Modify: `backend/app/core/constants.py`, `backend/app/schemas/transit.py`, `backend/app/orchestration/exception_service.py`, `backend/app/api/v1/endpoints/exceptions.py`
- Test: `backend/tests/integration/test_exception_batch_review.py` (new), and `backend/tests/unit/test_exception_service.py` (one emit test)

**Interfaces:**
- Consumes: `_lock_for_review`'s locking rule, `with_reviewer_names`, `_read_with_trip`, the Task 3 errors, and `BatchReviewRejectedError`.
- Produces:
  - `MAX_BATCH_REVIEW_SIZE = 100`
  - `TripExceptionBatchReviewRequest(trip_id: UUID, exception_ids: list[UUID], review_note, review_outcome, contact_method)`
  - `exception_service.review_exceptions_batch(db, *, trip_id, exception_ids, user_id, organization_id, review_note, review_outcome, contact_method) -> list[TripExceptionRead]`
  - `POST /api/v1/exceptions/review-batch` → 200 `list[TripExceptionRead]`. Returns 404 if any id is missing or cross-org; 422 for a critical row, a row from another trip, an empty list, more than 100 ids, or duplicate ids; 409 for a colleague's claim or a colleague's review.
  - A batch **never takes over** (no `take_over` field). Taking a colleague's claim is a per-exception decision, and the trip panel only offers unclaimed rows or rows claimed by you (Task 8). So a colleague's claim inside a batch can only come from a stale page, and it gets a 409.

- [ ] **Step 1: Write the failing tests.** Create `backend/tests/integration/test_exception_batch_review.py`. Reuse the same copied helpers as Task 3 (`override_get_db`, `_seed_org_with_exception`, `two_orgs`, `_headers`, `_colleague`, `_headers_for`), then:

```python
_URL = "/api/v1/exceptions/review-batch"


async def _warnings(db_session, trip, n: int) -> list[TripException]:
    rows = [
        TripException(
            id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.CHECKPOINT_TIMEOUT,
            source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING, description=f"warn {i}",
        )
        for i in range(n)
    ]
    db_session.add_all(rows)
    await db_session.flush()
    return rows


def _batch(trip_id, ids, **overrides) -> dict:
    body = {
        "trip_id": str(trip_id),
        "exception_ids": [str(i) for i in ids],
        "review_note": "Demo trip — checkpoint timeouts expected on this route.",
        "review_outcome": DispatcherReviewOutcome.NO_ACTION_REQUIRED.value,
        "contact_method": None,
    }
    body.update(overrides)
    return body


async def test_batch_review_writes_one_review_per_row(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 3)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 200
    assert len(res.json()) == 3
    for row in rows:
        await db_session.refresh(row)
        assert row.review_status == ExceptionReviewStatus.REVIEWED
        assert row.review_outcome == ExceptionReviewOutcome.NO_ACTION_REQUIRED
        assert row.reviewed_by_user_id == mine["user"].id
        assert row.claimed_by_user_id == mine["user"].id
    assert len({r.reviewed_at for r in rows}) == 1


async def test_batch_review_leaves_unlisted_rows_unreviewed(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    listed, unlisted = await _warnings(db_session, mine["trip"], 2)

    await client.post(_URL, json=_batch(mine["trip"].id, [listed.id]), headers=_headers(mine))

    await db_session.refresh(unlisted)
    assert unlisted.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_with_a_critical_row_is_422_and_changes_nothing(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    [warning] = await _warnings(db_session, mine["trip"], 1)
    ids = [warning.id, mine["exception"].id]  # the seeded row is CRITICAL

    res = await client.post(_URL, json=_batch(mine["trip"].id, ids), headers=_headers(mine))

    assert res.status_code == 422
    await db_session.refresh(warning)
    assert warning.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_spanning_two_trips_is_422(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    first = mine["trip"]
    [here] = await _warnings(db_session, first, 1)
    second = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-2-{uuid.uuid4().hex[:6]}", order_number=f"ORD-2-{uuid.uuid4().hex[:6]}",
        operator_organization_id=first.operator_organization_id,
        client_organization_id=first.client_organization_id,
        driver_id=first.driver_id, horse_id=first.horse_id,
        origin_precinct_id=first.origin_precinct_id, destination_precinct_id=first.destination_precinct_id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=first.created_by_user_id,
    )
    db_session.add(second)
    await db_session.flush()
    [there] = await _warnings(db_session, second, 1)

    res = await client.post(_URL, json=_batch(first.id, [here.id, there.id]), headers=_headers(mine))

    assert res.status_code == 422
    await db_session.refresh(here)
    assert here.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_with_a_cross_org_id_is_404(client, db_session, two_orgs):
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]
    [mine_row] = await _warnings(db_session, mine["trip"], 1)
    [their_row] = await _warnings(db_session, theirs["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [mine_row.id, their_row.id]), headers=_headers(mine))

    assert res.status_code == 404
    await db_session.refresh(mine_row)
    assert mine_row.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_over_a_colleagues_claim_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    ana = await _colleague(db_session, mine["org"])
    rows[1].claimed_by_user_id = ana.id
    await db_session.flush()

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(rows[0])
    assert rows[0].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_including_a_colleagues_review_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    ana = await _colleague(db_session, mine["org"])
    await client.patch(_review_url(rows[1].id), json=_body(), headers=_headers_for(ana, mine["org"]))

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(rows[0])
    assert rows[0].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_replay_by_same_dispatcher_is_idempotent(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    body = _batch(mine["trip"].id, [r.id for r in rows])
    first = await client.post(_URL, json=body, headers=_headers(mine))

    second = await client.post(_URL, json=body, headers=_headers(mine))

    assert second.status_code == 200
    assert [r["reviewed_at"] for r in second.json()] == [r["reviewed_at"] for r in first.json()]


@pytest.mark.parametrize("ids_factory", [
    lambda rows: [],
    lambda rows: [rows[0].id, rows[0].id],
    lambda rows: [uuid.uuid4() for _ in range(101)],
])
async def test_batch_with_invalid_id_list_is_422(client, db_session, two_orgs, ids_factory):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, ids_factory(rows)), headers=_headers(mine))

    assert res.status_code == 422


async def test_batch_without_credentials_is_403(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [rows[0].id]))

    assert res.status_code == 403
```

`_review_url` and `_body` come from the helpers copied from `test_exceptions_dispatcher.py`. `TripStatus` and `IdvsStatus` are already in that module's enum import. If `Trip(...)` requires more kwargs than shown (check the model), copy them from `_seed_org_with_exception`.

Add to `tests/unit/test_exception_service.py`:

```python
async def test_batch_review_enqueues_one_event_for_the_whole_batch(db_session):
    seed = await _seed(db_session, tag="batch-emit")
    warnings = [
        TripException(
            id=uuid.uuid4(), trip_id=seed["trip"].id, exception_type=ExceptionType.CHECKPOINT_TIMEOUT,
            source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING, description=f"warn {i}",
        )
        for i in range(2)
    ]
    db_session.add_all(warnings)
    await db_session.flush()

    await review_exceptions_batch(
        db_session, trip_id=seed["trip"].id, exception_ids=[w.id for w in warnings],
        user_id=seed["user"].id, organization_id=seed["org"].id, review_note="Batch.",
        review_outcome=DispatcherReviewOutcome.NO_ACTION_REQUIRED, contact_method=None,
    )

    kinds = [event.kind for _org, event in _outbox(db_session)]
    assert kinds == [RealtimeKind.EXCEPTION_REVIEWED]
```

Add `review_exceptions_batch` to the module's `exception_service` import. Add `ExceptionSource` and `ExceptionType` to its enum import if they're missing.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_batch_review.py -v`. Expected: FAIL with 404/405 on the route.

- [ ] **Step 3: Implement.**

`app/core/constants.py`:

```python
# Upper bound on one batch review. Batches exist to clear a trip's routine warnings in one
# pass; a request past this is not a dispatcher looking at rows, and one bounded
# transaction keeps the row locks short.
MAX_BATCH_REVIEW_SIZE = 100
```

`app/schemas/transit.py` (import `MAX_BATCH_REVIEW_SIZE`):

```python
class TripExceptionBatchReviewRequest(BaseModel):
    """Review several non-critical exceptions on ONE trip with one note and outcome.

    Explicit ids, never "every warning on the trip": the dispatcher confirms exactly the
    rows they saw, so a warning raised after the page loaded is never swept into a
    review nobody looked at. One review is still written per row.
    """

    trip_id: UUID
    exception_ids: list[UUID] = Field(min_length=1, max_length=MAX_BATCH_REVIEW_SIZE)
    review_note: RequiredFreeText
    review_outcome: DispatcherReviewOutcome
    contact_method: Optional[ExceptionContactMethod]

    @field_validator("exception_ids")
    @classmethod
    def _ids_are_unique(cls, ids: list[UUID]) -> list[UUID]:
        # A duplicate is a client bug, not a harmless repeat — reject it rather than
        # quietly reviewing fewer rows than the dispatcher was shown.
        if len(set(ids)) != len(ids):
            raise ValueError("exception_ids must not repeat")
        return ids
```

`exception_service.py`: add after `release_exception`, and import `BatchReviewRejectedError`:

```python
async def review_exceptions_batch(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    exception_ids: Sequence[uuid.UUID],
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    review_note: str,
    review_outcome: DispatcherReviewOutcome,
    contact_method: ExceptionContactMethod | None,
) -> list[TripExceptionRead]:
    """Review several non-critical exceptions on one trip in one transaction (FP-280).

    All or nothing: every rule is checked against every locked row before any row is
    written, so a 404/409/422 leaves the batch untouched. Per row, the single-review
    rules hold — a colleague's claim or review is a 409; a row this dispatcher already
    reviewed is left exactly as it is (a replayed batch is idempotent); an unclaimed row
    is auto-claimed. Critical rows are refused: each one gets its own review.

    Raises:
        ResourceNotFoundError: an id is missing or in another organisation (-> 404).
        BatchReviewRejectedError: a critical row, or rows from another trip (-> 422).
        ExceptionClaimedByColleagueError / ExceptionAlreadyReviewedError (-> 409).
    """
    rows = (await db.execute(
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(TripException.id.in_(exception_ids), Trip.operator_organization_id == organization_id)
        # A fixed lock order, so two overlapping batches queue behind each other rather
        # than deadlock. Same row lock as _lock_for_review, for the same reason.
        .order_by(TripException.id)
        .with_for_update(of=TripException)
    )).tuples().all()
    found = {exc.id: exc for exc, _trip in rows}
    missing = [eid for eid in exception_ids if eid not in found]
    if missing:
        raise ResourceNotFoundError("TripException", str(missing[0]))
    trip = rows[0][1]

    if any(exc.trip_id != trip_id for exc in found.values()):
        raise BatchReviewRejectedError("Every exception in a batch review must belong to the same trip.")
    if any(exc.severity == ExceptionSeverity.CRITICAL for exc in found.values()):
        raise BatchReviewRejectedError("Critical exceptions are reviewed one at a time, never in a batch.")
    for exc in found.values():
        if exc.review_status == ExceptionReviewStatus.REVIEWED:
            if exc.reviewed_by_user_id != user_id:
                raise ExceptionAlreadyReviewedError(str(exc.id))
        elif exc.claimed_by_user_id is not None and exc.claimed_by_user_id != user_id:
            raise ExceptionClaimedByColleagueError(str(exc.id))

    now = datetime.now(UTC)
    outcome = ExceptionReviewOutcome(review_outcome.value)
    newly_reviewed = [exc for exc in found.values() if exc.review_status != ExceptionReviewStatus.REVIEWED]
    for exc in newly_reviewed:
        if exc.claimed_by_user_id is None:
            exc.claimed_by_user_id = user_id
            exc.claimed_at = now
        exc.review_status = ExceptionReviewStatus.REVIEWED
        exc.review_outcome = outcome
        exc.reviewed_by_user_id = user_id
        exc.reviewed_at = now
        exc.review_note = review_note
        exc.contact_method = contact_method
    await db.flush()
    for exc in newly_reviewed:
        await db.refresh(exc)

    if newly_reviewed:
        # Metadata only — never the note (see review_exception).
        logger.info(
            "Exceptions batch-reviewed: trip=%s by=%s count=%d outcome=%s",
            trip_id, user_id, len(newly_reviewed), review_outcome.value,
        )
        # One event for the batch: every screen refetches once either way.
        enqueue_event(db, trip.operator_organization_id, TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_REVIEWED,
            severity=event_severity(ExceptionSeverity.INFO),
        ))

    ordered = sorted(found.values(), key=lambda exc: (exc.created_at, exc.id), reverse=True)
    return await with_reviewer_names(
        db, organization_id=organization_id, reads=[_read_with_trip(exc, trip) for exc in ordered],
    )
```

`endpoints/exceptions.py`: declare this directly after `review_queue_endpoint`, and import the new names.

```python
# Rate-limited as a single mutation: one request, one bounded transaction.
@dispatcher_router.post("/review-batch", response_model=list[TripExceptionRead],
                        dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def review_batch_endpoint(
    payload: TripExceptionBatchReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripExceptionRead]:
    """Review several non-critical exceptions on one trip with one note and outcome."""
    try:
        return await review_exceptions_batch(
            db, trip_id=payload.trip_id, exception_ids=payload.exception_ids,
            user_id=current_user.id, organization_id=current_user.organization_id,
            review_note=payload.review_note, review_outcome=payload.review_outcome,
            contact_method=payload.contact_method,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BatchReviewRejectedError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except (ExceptionAlreadyReviewedError, ExceptionClaimedByColleagueError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run: `cd backend && .venv/bin/pytest tests/integration/test_exception_batch_review.py tests/unit/test_exception_service.py -v`. Expected: PASS.

- [ ] **Step 5: Gates.** In `backend/`: `.venv/bin/ruff check . && .venv/bin/mypy . && .venv/bin/pytest -m "not slow"` — all green.

- [ ] **Step 6: Stage.** Suggested commit: `feat(api): batch review of non-critical exceptions on one trip`

---

### Task 5: Frontend foundations — types, realtime kind, API client, review-state formatter

**Files:**
- Modify:
  - `frontend/shared/lib/types/exception.ts`
  - `frontend/dispatcher/lib/realtime/types.ts`
  - `frontend/dispatcher/lib/api/client.ts`
  - `frontend/dispatcher/lib/hooks/useExceptions.ts`
  - `frontend/dispatcher/lib/hooks/useExceptionDetail.ts`
  - every mock or fixture that builds a `TripException` or `TripExceptionListItem` (type-check will list them; start with `frontend/shared/lib/mocks/trips.ts`)
- Create: `frontend/dispatcher/lib/format/review-state.ts`, `frontend/dispatcher/lib/format/review-state.test.ts`
- Test: extend `useExceptions.test.tsx` and `useExceptionDetail.test.tsx` if they assert the `kinds` array

**Interfaces:**
- Produces:
  - TypeScript fields `claimed_by_user_id: string | null`, `claimed_at: string | null`, `claimed_by_name: string | null`, `reviewed_by_name: string | null` on `TripException` and `TripExceptionListItem`
  - `'dispatcher_authored'` in `ExceptionReviewOutcome`
  - `DispatcherReviewOutcome = Exclude<ExceptionReviewOutcome, 'legacy_review' | 'dispatcher_authored'>`
  - `RealtimeKind` gains `'exception_claimed'`
  - `api.delete<T>(path)`
  - `claimException(exceptionId: string, takeOver?: boolean): Promise<TripException>`
  - `releaseException(exceptionId: string): Promise<TripException>`
  - `reviewExceptionBatch(body: BatchReviewBody): Promise<TripException[]>`, with `BatchReviewBody = { trip_id: string; exception_ids: string[]; review_note: string; review_outcome: DispatcherReviewOutcome; contact_method: ExceptionContactMethod | null }`
  - `reviewException`'s body type gains `take_over?: boolean`. Existing callers are unchanged; omitting it means false on the server.
  - `reviewState(ex: ReviewStateInput, currentUserId: string | null): ReviewState`, where `ReviewState = { kind: 'unreviewed' | 'claimed_by_me' | 'claimed_by_other' | 'reviewed' | 'authored' | 'recorded'; label: string }`, and `ReviewStateInput = Pick<TripExceptionListItem, 'review_status' | 'claimed_by_user_id' | 'claimed_by_name' | 'reviewed_by_name'> & { review_outcome?: ExceptionReviewOutcome | null }`

- [ ] **Step 1: Write the failing formatter test.** Create `frontend/dispatcher/lib/format/review-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reviewState } from './review-state'

const base = { review_status: 'needs_review' as const, claimed_by_user_id: null, claimed_by_name: null, reviewed_by_name: null }

describe('reviewState', () => {
  it('is Unreviewed when nobody holds it', () => {
    expect(reviewState(base, 'me')).toEqual({ kind: 'unreviewed', label: 'Unreviewed' })
  })
  it('is Claimed by you for my own claim', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'me', claimed_by_name: 'Me' }, 'me'))
      .toEqual({ kind: 'claimed_by_me', label: 'Claimed by you' })
  })
  it("names a colleague's claim", () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'ana', claimed_by_name: 'Ana' }, 'me'))
      .toEqual({ kind: 'claimed_by_other', label: 'Claimed by Ana' })
  })
  it('falls back when the claimer name is unavailable', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'ana' }, 'me').label).toBe('Claimed by a colleague')
  })
  it('treats every claim as a colleague while the session is still loading', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'me', claimed_by_name: 'Me' }, null).kind).toBe('claimed_by_other')
  })
  it('names the reviewer', () => {
    expect(reviewState({ ...base, review_status: 'reviewed', reviewed_by_name: 'Ben' }, 'me'))
      .toEqual({ kind: 'reviewed', label: 'Reviewed by Ben' })
  })
  it("marks a dispatcher's own note as written, not reviewed", () => {
    expect(reviewState({ ...base, review_status: 'reviewed', review_outcome: 'dispatcher_authored', reviewed_by_name: 'Ben' }, 'me'))
      .toEqual({ kind: 'authored', label: 'Dispatcher note by Ben' })
  })
  it('keeps legacy recorded rows readable', () => {
    expect(reviewState({ ...base, review_status: 'recorded' }, 'me')).toEqual({ kind: 'recorded', label: 'Recorded' })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails.** Run: `cd frontend/dispatcher && npx vitest run lib/format/review-state.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

`review-state.ts`:

```ts
import type { ExceptionReviewOutcome, TripExceptionListItem } from '@shared/lib/types/exception'

export type ReviewStateKind = 'unreviewed' | 'claimed_by_me' | 'claimed_by_other' | 'reviewed' | 'authored' | 'recorded'
export interface ReviewState { kind: ReviewStateKind; label: string }
export type ReviewStateInput =
  Pick<TripExceptionListItem, 'review_status' | 'claimed_by_user_id' | 'claimed_by_name' | 'reviewed_by_name'>
  & { review_outcome?: ExceptionReviewOutcome | null }

/** One wording for an exception's place in the review workflow, used by the inbox, the
 *  detail page and every timeline card so the three can never disagree. `currentUserId`
 *  is null while the session loads; a claim is then shown as a colleague's, the safe
 *  reading, since it offers take-over rather than review. */
export function reviewState(ex: ReviewStateInput, currentUserId: string | null): ReviewState {
  if (ex.review_status === 'reviewed') {
    const who = ex.reviewed_by_name ?? 'a dispatcher'
    return ex.review_outcome === 'dispatcher_authored'
      ? { kind: 'authored', label: `Dispatcher note by ${who}` }
      : { kind: 'reviewed', label: `Reviewed by ${who}` }
  }
  if (ex.review_status === 'recorded') return { kind: 'recorded', label: 'Recorded' }
  if (ex.claimed_by_user_id === null) return { kind: 'unreviewed', label: 'Unreviewed' }
  if (currentUserId !== null && ex.claimed_by_user_id === currentUserId) {
    return { kind: 'claimed_by_me', label: 'Claimed by you' }
  }
  return { kind: 'claimed_by_other', label: `Claimed by ${ex.claimed_by_name ?? 'a colleague'}` }
}
```

The types, realtime kind and hooks come next. Add `'exception_claimed'` to `RealtimeKind` in `lib/realtime/types.ts`, and to the `kinds` arrays in `useExceptionQueue` and `useExceptionDetail`. Update the comment in `useExceptions.ts` to "claims too — a colleague claiming must move the row between tabs".

`client.ts`: add `delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),` to `api`. Widen `reviewException`'s body type to `{ review_note: string; review_outcome: DispatcherReviewOutcome; contact_method: ExceptionContactMethod | null; take_over?: boolean }`, and add a line to its JSDoc: "`take_over: true` takes a colleague's claim and reviews in one step (soft claim); omit it otherwise." Then add:

```ts
/** POST /exceptions/{id}/claim — the caller is now working this exception. takeOver
 *  replaces a colleague's claim; without it a colleague's claim is a 409. */
export function claimException(exceptionId: string, takeOver = false): Promise<TripException> {
  return api.post<TripException>(`/api/v1/exceptions/${exceptionId}/claim`, { take_over: takeOver })
}

/** DELETE /exceptions/{id}/claim — give the exception back to the unreviewed inbox. */
export function releaseException(exceptionId: string): Promise<TripException> {
  return api.delete<TripException>(`/api/v1/exceptions/${exceptionId}/claim`)
}

export interface BatchReviewBody {
  trip_id: string
  exception_ids: string[]
  review_note: string
  review_outcome: DispatcherReviewOutcome
  contact_method: ExceptionContactMethod | null
}

/** POST /exceptions/review-batch — one note and outcome across several non-critical
 *  exceptions on one trip. Explicit ids: only the rows the dispatcher was shown. */
export function reviewExceptionBatch(body: BatchReviewBody): Promise<TripException[]> {
  return api.post<TripException[]>('/api/v1/exceptions/review-batch', body)
}
```

- [ ] **Step 4: Fix type-check fallout.**
  Run: `cd frontend/dispatcher && npm run type-check` and `cd frontend/driver-pwa && npm run type-check`.
  Add the four new fields (as `null`) to every mock or fixture flagged. Where a `Record<DispatcherReviewOutcome, …>` or a `!== 'legacy_review'` check breaks (for example `exceptions/[id]/page.tsx:358`), exclude `'dispatcher_authored'` in the same way.

- [ ] **Step 5: Run the tests and confirm they pass.** In `frontend/dispatcher`: `npx vitest run lib/format lib/hooks`, then `npm run type-check`. In `frontend/driver-pwa`: `npm run type-check && npm test`. All green.

- [ ] **Step 6: Stage.** Suggested commit: `feat(shared): exception claim fields, claim/release/batch client, review-state formatter`

---

### Task 6: Exceptions page — Unreviewed / Claimed by me / Reviewed tabs

**Files:**
- Modify: `frontend/dispatcher/app/(app)/exceptions/page.tsx`
- Test: `frontend/dispatcher/app/(app)/exceptions/page.test.tsx`

**Interfaces:**
- Consumes: `reviewState`, `useAuth().user?.id`, and `useExceptionQueue().items` (already in severity order from the server).

**Behaviour:**
- Tabs:
  - `'unreviewed'`: queue rows where `reviewState(...).kind` is `'unreviewed'` or `'claimed_by_other'`
  - `'mine'`: kind `'claimed_by_me'`
  - `'reviewed'`: the existing `HistoryTab`, unchanged apart from its label
- Each queue tab label shows its count, e.g. `Unreviewed · 4` and `Claimed by me · 1`.
- Both queue tabs render from **one** `useExceptionQueue()` fetch. Splitting on the client keeps the counts consistent with the lists, as the scaling note requires.
- Each queue row shows a chip with `reviewState(item, me).label`, passed through `ExceptionRow`'s existing `trailing` slot. Use chip types that already exist in `ChipType`: neutral for Unreviewed, a highlight for "Claimed by you", muted for "Claimed by Ana". Check `@shared/lib/constants/status-meta` for the available `ChipType` values.
- History rows keep their current status badge, but use `reviewState(...).label`, so they read "Reviewed by Ben".
- Rename the `SecHead` title "Needs Review" to "Unreviewed" or "Claimed by me", to match the tab.
- The empty state on "Claimed by me" reads "Nothing claimed — claim an exception from Unreviewed to work it."

- [ ] **Step 1: Write the failing tests** in `page.test.tsx`. Follow the file's existing mocking of `useExceptionQueue` and `useExceptionHistory`, and mock `useAuth` to return `{ user: { id: 'me', … } }`.
  - `it('splits the queue into Unreviewed and Claimed by me with counts')`: three queue items, one claimed by `'me'`, one by `'ana'` with the name `'Ana'`, one unclaimed. Expect the tab buttons "Unreviewed · 2" and "Claimed by me · 1". The Unreviewed tab shows the "Claimed by Ana" chip. Clicking "Claimed by me" shows only the row claimed by me, with "Claimed by you".
  - `it('shows the reviewer on the Reviewed tab')`: a history item with `review_status: 'reviewed'` and `reviewed_by_name: 'Ben'`. Clicking "Reviewed" shows "Reviewed by Ben".
  - `it('keeps queue order from the server')`: items in critical, warning, info order render in that order.
  - Update the existing tests that click "Needs Review" or "History" to use the new labels.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cd frontend/dispatcher && npx vitest run "app/(app)/exceptions/page.test.tsx"`. Expected: FAIL.

- [ ] **Step 3: Implement.** Change `type Tab = 'queue' | 'history'` to `type Tab = 'unreviewed' | 'mine' | 'reviewed'`. Compute the two partitions with `useMemo` from `queue.items` and `user?.id ?? null`. Reuse `QueueTab`, passing it `items`, a `title` and an `emptyState`, instead of it reading `queue.items` itself; keep its loading, error and stale-banner logic intact. Replace `reviewStatusMeta` with `reviewState` (keep the `ChipType` mapping local to this page).

- [ ] **Step 4: Run the tests and confirm they pass.** Then run `npm run type-check && npm run lint`.

- [ ] **Step 5: Stage.** Suggested commit: `feat(dispatcher): unreviewed inbox with Claimed by me and Reviewed tabs`

---

### Task 7: Exception detail page — claim, release, take over, reviewer identity

**Files:**
- Create: `frontend/dispatcher/components/domain/ReviewFields.tsx`. Move `REVIEW_OUTCOME_LABELS`, `CONTACT_METHOD_LABELS`, `NO_OUTCOME_CHOSEN`, `NO_CONTACT_CHOSEN` and the three inputs (note, outcome, contact) out of `exceptions/[id]/page.tsx`, unchanged.
- Modify: `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx`
- Test: `frontend/dispatcher/app/(app)/exceptions/[id]/page.test.tsx`

**Interfaces:**
- Produces: `ReviewFields` with props `{ note: string; onNote(v: string): void; outcome: DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN; onOutcome(v): void; contact: ExceptionContactMethod | typeof NO_CONTACT_CHOSEN; onContact(v): void }`. It also exports `NO_OUTCOME_CHOSEN`, `NO_CONTACT_CHOSEN`, `REVIEW_OUTCOME_LABELS` and `CONTACT_METHOD_LABELS`. Task 8 consumes all of these.

**Behaviour (by `reviewState(exception, me).kind`):**
- `unreviewed`: a **Claim** button above the review form, and the form enabled. Submitting auto-claims (D6); no client call to `claimException` is needed first.
- `claimed_by_me`: the line "Claimed by you · {time}", a **Release** button, and the form enabled.
- `claimed_by_other`: the line "Claimed by Ana · {time}", a **Take over** button, and the form **still shown**, with its submit button labelled **Take over and review**. Submitting sends `reviewException(id, { ..., take_over: true })`. Pressing **Take over** alone calls `claimException(id, true)` and then `refetchSilent()`. The button label is the explicit statement of intent, so there's no extra confirm dialog.
- `reviewed` / `authored`: show "Reviewed by Ben · {time}" or "Dispatcher note by Ben · {time}". When the claimer differs from the reviewer, also show "Claimed by …". **Delete** the "Deliberately no reviewer identity here" comment block and replace it with: "Names come from the server (users.full_name, org-scoped) — FP-280."
- Every claim, release or take-over call: on success, `refetchSilent()` and a success toast. On a 409, an error toast titled "A colleague got there first", then `refetchSilent()`. On any other error, an error toast. Never swallow errors.
- The review 409 handler's title changes from 'Already reviewed by a colleague' to 'A colleague got there first', because a 409 can now mean either a claim or a review. Keep the note in the form (existing behaviour).

- [ ] **Step 1: Write the failing tests** in `[id]/page.test.tsx`, following the file's existing mocking of `useExceptionDetail` and the client:
  - `it('offers Take over and a Take over and review submit when a colleague holds the claim')`
  - `it('takes over and refetches')`: click **Take over**; expect `claimException(id, true)` to have been called, and `refetchSilent` too.
  - `it('takes over and reviews in one step')`: with the claim held by `'ana'`, fill the form and press **Take over and review**. Expect `reviewException` to have been called with `take_over: true`.
  - `it('sends no take_over for an unclaimed or own-claim review')`: the submit label is the normal review label, and the body omits `take_over` or sends false.
  - `it('releases my claim')`: `releaseException(id)` is called.
  - `it('keeps the typed note and refetches when review hits a 409')`: reject `reviewException` with `new ApiError(409, …)`. Use the existing `ApiError` constructor signature from `client.ts`. Expect the toast title "A colleague got there first", the note input to still hold the typed text, and `refetchSilent` to have been called. (After the refetch shows the colleague's claim, the submit reads "Take over and review" — that's covered by the claimed-by-other test above.)
  - `it('names the reviewer and claimer on a reviewed exception')`
  - `it('labels a dispatcher-authored note')`: `review_outcome: 'dispatcher_authored'` renders "Dispatcher note by Ben", and not the outcome label.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cd frontend/dispatcher && npx vitest run "app/(app)/exceptions/\[id\]/page.test.tsx"`. Expected: FAIL.

- [ ] **Step 3: Implement.** Extract `ReviewFields` first, run the existing detail tests (they should stay green), then add the claim UI. Add labels to `COPY` in `@shared/lib/constants/copy` **only** if that file already holds equivalent action labels (check `COPY.actions`). Otherwise keep the strings local. Don't add a new constants file.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run `npm run type-check && npm run lint`.

- [ ] **Step 5: Stage.** Suggested commit: `feat(dispatcher): claim, release and take over on the exception page; show reviewer and claimer`

---

### Task 8: Trip page — review status on every timeline card, batch review of warnings

**Files:**
- Modify: `frontend/dispatcher/components/domain/ExceptionSummary.tsx`. This card is rendered by both `TripExceptionsPanel` and the timeline's `PhaseExceptionGroup`.
- Modify: `frontend/dispatcher/components/trips/TripExceptionsPanel.tsx`
- Create: `frontend/dispatcher/components/trips/BatchReviewForm.tsx`, `BatchReviewForm.test.tsx`
- Test: `TripExceptionsPanel.test.tsx`, and `PhaseExceptionGroup.test.tsx` / `TripTimeline.test.tsx` if they assert the old "Needs review" text

**Interfaces:**
- Consumes: `reviewState`, `ReviewFields` (Task 7), `reviewExceptionBatch` (Task 5), `useAuth`, and `useToast`.
- Produces: `BatchReviewForm` with props `{ tripId: string; exceptions: TripException[]; onDone(): void; onCancel(): void }`.

**Behaviour:**
- `ExceptionSummary`: replace the hand-written `needs_review`/`reviewed`/`recorded` ternary (around line 57) with `reviewState(exception, user?.id ?? null).label`, followed by ` · {time}`. The time is `reviewed_at` for reviewed rows and `claimed_at` for claimed rows. Keep the outcome suffix, except for `dispatcher_authored`. The link text stays "Review exception" for any non-reviewed state.
- `TripExceptionsPanel`: the filter label `Needs review · N` becomes `Unreviewed · N`. The filter value stays `'needs_review'`; don't rename the `ExceptionFilter` type, because other components pass it.
  - Compute `batchable` = the scoped exceptions where `review_status === 'needs_review'`, `severity !== 'critical'`, and `claimed_by_user_id` is null or is me.
  - When `batchable.length > 0`, show a **Review N warnings** button, which toggles `BatchReviewForm` inline above the list.
- `BatchReviewForm`:
  - Lists the rows it will review: type and time, one line each, so the dispatcher sees exactly what they are signing for.
  - Renders `ReviewFields` and submits `reviewExceptionBatch({ trip_id, exception_ids: exceptions.map(e => e.id), ... })`.
  - On success: a toast "N exceptions reviewed", then `onDone()`. The trip page refetches through its live subscription; `onDone` just closes the form.
  - On a 409: the error toast "A colleague got there first", and the form stays open.
  - On a 422: an error toast showing the server's `detail`.
  - Submit is disabled until the note and outcome are set, matching the detail page's gate.

- [ ] **Step 1: Write the failing tests.**
  - `BatchReviewForm.test.tsx`:
    - `it('submits exactly the listed ids with one note and outcome')`
    - `it('blocks submit until note and outcome are set')`
    - `it('stays open and toasts on 409')`
  - `TripExceptionsPanel.test.tsx`:
    - `it('offers batch review only for my or unclaimed non-critical unreviewed rows')`: build a critical row, a warning claimed by `'ana'`, an unclaimed warning and an info row claimed by me. Expect the button to read "Review 2 warnings".
    - `it('hides batch review when nothing is batchable')`
  - An `ExceptionSummary` assertion, added to an existing test that renders it: a claimed row shows "Claimed by Ana".
  - Update existing assertions on "Needs review ·" to "Unreviewed ·".

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `cd frontend/dispatcher && npx vitest run components/trips components/domain`. Expected: FAIL.

- [ ] **Step 3: Implement,** as described under Behaviour above.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full frontend gates:
  - `cd frontend/dispatcher && npm run type-check && npm run lint && npm test`
  - `cd frontend/driver-pwa && npm run type-check && npm test`

- [ ] **Step 5: Stage.** Suggested commit: `feat(dispatcher): review status on every trip exception and batch review of a trip's warnings`

---

### Task 9: Final verification and hand-off

- [ ] **Step 1: Full gates, in the foreground.**
  - `cd backend && .venv/bin/ruff check . && .venv/bin/mypy . && .venv/bin/pytest -m "not slow"`
  - The dispatcher and driver-pwa frontend gates from Task 8.
  - Paste the pass/fail counts into the report.
- [ ] **Step 2: Invariant spot-check.**
  - `grep -rn "review_status=ExceptionReviewStatus\.\(RECORDED\|NEEDS_REVIEW\)" backend/app/orchestration/` must return nothing.
  - `grep -rn "_initial_review_status" backend/app` must return nothing.
- [ ] **Step 3: Browser check (optional; needs Ciaran's local DB migrated, so skip if it isn't).** Start the dispatcher preview (`.claude/launch.json`). Screenshot:
  - `/exceptions` showing the three tabs
  - an exception claimed by another user showing Take over and "Take over and review"
  - a trip page showing "Claimed by …" / "Reviewed by …" on timeline cards, and the "Review N warnings" form
- [ ] **Step 4: Docs.**
  - In `docs/design-notes/2026-09-04-exception-queue-scaling.md`, change the `Status` line to `implemented (FP-146/147/148; invariant widened to every write site in FP-280)`.
  - Update `backend/docs/api_contract_dispatcher_driver.md` if it documents the exception routes: add the claim, release and batch endpoints and the four new fields.
- [ ] **Step 5: TASK COMPLETE report** (CLAUDE.md format). It must include:
  - **Migration:** `2026_09_30_ciaran_exception_claims.py`, not applied. Ciaran runs `alembic upgrade head` from `dev` after merge. The backfill moves every `recorded` row into the inbox, so the demo DB inbox will fill until batch review clears it.
  - **Heads-up for Thomas (Review Desk analytics):**
    - The "waiting" and "queue" charts filter on critical, so they are unchanged.
    - The outcomes chart will now include batch-reviewed warnings.
    - `dispatcher_authored` rows are excluded automatically, because `outcomes()` iterates `DispatcherReviewOutcome`.
    - `needs_review_count` on trip boards now counts warnings and info too.
  - **Known follow-ups (not built):**
    - cross-trip bulk review from the inbox (D4)
    - a claim-history table (take-overs are logged, not stored)
    - the driver PWA's `needs_review_count` now includes warnings, where spec §5.1 says critical only
    - `ChecklistRow` paints any unreviewed row red
    - `raised_by_user_id`, so cancel notes can stop embedding the user id in `description`
  - **Deprecations:** anything found along the way.
  - **Shared files:** none from the CLAUDE.md list.
