"""What a receiver verification concluded, and the exception it files: the vendor's decision plus
our own cross-check mapped onto our verdict, then recorded as a TripException when it is a finding.
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.errors import DatabaseUnavailableError
from app.db.models.enums import (
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.integrations.idvs import IdvsDecisionStatus
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.exceptions.review_policy import initial_review_status

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Verdict:
    """What we concluded, derived from what the vendor said plus our own cross-check.

    Separate from IdvsDecision on purpose: that is the vendor's vocabulary, this is
    ours, and the mapping between them is a judgement this module owns.
    """

    status: ReceiverVerificationStatus
    tier: ReceiverVerificationTier
    unverified_reason: Optional[ReceiverVerificationUnverifiedReason] = None
    exception_type: Optional[ExceptionType] = None


def resolve_verdict(
    *, status: IdvsDecisionStatus, identity_match: Optional[bool],
) -> Verdict:
    """Map a vendor status and cross-check result onto our verdict and its exception.

    Two rules: (1) a GAP is not a MISMATCH — ABANDONED/EXPIRED are benign (lost
    signal, walked away) and raise RECEIVER_ID_UNVERIFIED, while DECLINED or a
    failed cross-check raise RECEIVER_ID_MISMATCH. (2) identity_match=None means
    nothing to compare, not disagreement — an APPROVED session with no extracted
    document data is still VERIFIED.

    A non-terminal status yields PENDING and no exception; the sweeper terminalises
    it later.
    """
    if not status.is_terminal:
        return Verdict(
            status=ReceiverVerificationStatus.PENDING,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.APPROVED:
        if identity_match is False:
            return Verdict(
                status=ReceiverVerificationStatus.FAILED,
                tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
                exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
            )
        return Verdict(
            status=ReceiverVerificationStatus.VERIFIED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.DECLINED:
        return Verdict(
            status=ReceiverVerificationStatus.FAILED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
            exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
        )

    # ABANDONED / EXPIRED — the gap case. Both map to ABANDONED: "they walked away"
    # and "the link aged out" are the same fact to the evidence record.
    return Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        unverified_reason=ReceiverVerificationUnverifiedReason.ABANDONED,
        exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
    )


async def raise_verification_exception(
    db: AsyncSession,
    *,
    trip: Trip,
    phase_event_id: uuid.UUID,
    trip_stop_id: Optional[uuid.UUID],
    verdict: Verdict,
) -> None:
    """Record a verification finding as a TripException, and tell the dispatcher.

    Severity follows the gap/mismatch split: MISMATCH is a fraud indicator with no
    benign reading (WARNING); an UNVERIFIED gap ("no ID on them") is ordinary
    (INFO). Never CRITICAL — reserved for findings that stop a trip, and
    verification never gates a delivery.

    Optional paperwork failures are fail-open; DB outages propagate as the
    transaction cannot persist the confirmation either.
    """
    if verdict.exception_type is None:
        return

    severity = (
        ExceptionSeverity.WARNING
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else ExceptionSeverity.INFO
    )
    description = (
        "The identity presented by the receiver did not match the verified document."
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else (
            "The receiver's identity could not be verified at handover "
            f"({verdict.unverified_reason.value if verdict.unverified_reason else 'unknown'})."
        )
    )

    trip_id = trip.id  # plain value for the failure log; a rolled-back savepoint can expire `trip`
    try:
        # Idempotent: the same finding on the same handover is one fact. A repeated resolve
        # (a reload, a double tap) must not file it again. `trip_stop_id` may be NULL, which
        # `==` would never match, hence the explicit IS NULL branch.
        # The dedupe read and the insert share one SAVEPOINT so the check-then-write is a unit
        # that rolls back together, and so a database error here rolls back to this point
        # instead of aborting the receiver's transaction (which also carries the verdict).
        async with db.begin_nested():
            already_filed = (await db.execute(
                select(TripException.id).where(
                    TripException.trip_id == trip.id,
                    TripException.phase_event_id == phase_event_id,
                    TripException.trip_stop_id.is_(None) if trip_stop_id is None
                    else TripException.trip_stop_id == trip_stop_id,
                    TripException.exception_type == verdict.exception_type,
                ).limit(1)
            )).first()
            if already_filed is not None:
                logger.info(
                    "Receiver verification exception %s already filed for trip=%s phase_event=%s; not repeating",
                    verdict.exception_type.value, trip.id, phase_event_id,
                )
                return

            await register_exception(db, TripException(
                trip_id=trip.id,
                phase_event_id=phase_event_id,
                trip_stop_id=trip_stop_id,
                exception_type=verdict.exception_type,
                source=ExceptionSource.SYSTEM,
                severity=severity,
                review_status=initial_review_status(severity),
                description=description,
            ))
            await db.flush()

        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id,
                kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(severity),
            ),
        )
    except DatabaseUnavailableError:
        raise
    except Exception:
        logger.exception(
            "Could not record a receiver verification exception for trip=%s phase_event=%s "
            "— the verification row still carries the finding",
            trip_id, phase_event_id,
        )
