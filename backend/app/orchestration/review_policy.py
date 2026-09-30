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


def initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:  # noqa: ARG001
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
