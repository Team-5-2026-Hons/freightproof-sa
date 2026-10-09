"""FP-280 — every exception enters the dispatcher review workflow.

DB-backed where the column default is under test: Base.metadata.create_all builds the
test schema from the model, so the model's server_default is what these rows get.
"""

import uuid
from datetime import UTC, datetime

import pytest
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
from app.orchestration.review_policy import dispatcher_authored_review, initial_review_status


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
