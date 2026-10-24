"""Raise one review exception for a completed driver transfer that carries a problem (FP-83).

An ordinary transfer is a planned, authorised custody amendment, so it raises nothing: putting every
one in the review queue would be noise. A transfer is flagged only when completion went ahead with a
gap a dispatcher watching Exceptions should see:

- the incoming driver's identity was not verified (including a dispatcher attestation over PENDING);
- a required driver confirmation was never recorded (a dispatcher completed it);
- the incoming capture's phone-versus-tracker comparison could not be made ("unverified").

A *separated* capture is not repeated here: capture_assessment already raises
DRIVER_VEHICLE_SEPARATION for it, and seal_comparison raises the seal findings. All reasons that fire
land in ONE exception, never one per reason.

Like those findings this is evidence, not a gate: it is fail-open. A failure to build or write it is
logged and the completion stands, and it never touches the trip's status (a WARNING exception does not
hold a trip; nothing in app/ sets EXCEPTION_HOLD). The caller must already hold the trip lock.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, IdvsStatus
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.exceptions.review_policy import initial_review_status
from app.schemas.driver_substitutions import SubstitutionRole

logger = logging.getLogger(__name__)

TRANSFER_REVIEW_SEVERITY = ExceptionSeverity.WARNING
# The proximity verdict that means "the phone and the tracker could not be compared".
UNVERIFIED_PROXIMITY = "unverified"

REASON_IDENTITY = "incoming identity not verified"
REASON_IDENTITY_ATTESTED = "incoming identity not verified (attested by dispatcher)"
REASON_CONFIRMATION = "required driver confirmation not recorded"
REASON_LOCATION = "handover location not verified"


def transfer_review_reasons(row: DriverSubstitution, incoming_proximity: str | None) -> list[str]:
    """Every reason this completed transfer needs a look, in a fixed order; empty when it is clean.

    `incoming_proximity` is the stored verdict of the incoming driver's capture, or None when there
    is no assessment to read (no capture, or one that could not be built): absence of a verdict is
    not the same as an "unverified" one, so it adds no reason.
    """
    reasons: list[str] = []
    if row.incoming_identity_status != IdvsStatus.VERIFIED.value:
        reasons.append(REASON_IDENTITY_ATTESTED if row.identity_attested_by_user_id is not None else REASON_IDENTITY)
    if row.missing_confirmation_reason is not None:
        reasons.append(REASON_CONFIRMATION)
    if incoming_proximity == UNVERIFIED_PROXIMITY:
        reasons.append(REASON_LOCATION)
    return reasons


def transfer_review_description(outgoing_name: str, incoming_name: str, reasons: list[str]) -> str:
    """One plain sentence naming both drivers, never ids, and listing every reason that fired."""
    return f"Driver transfer from {outgoing_name} to {incoming_name} completed with: {'; '.join(reasons)}."


async def raise_transfer_review(db: AsyncSession, *, trip: Trip, row: DriverSubstitution) -> uuid.UUID | None:
    """Write the review exception when the transfer has a reason for one; returns its id, else None.

    Everything that touches the database runs inside one savepoint, so a failed read or write rolls back
    to it and leaves the completion's transaction usable.
    """
    try:
        async with db.begin_nested():
            assessment = (await db.execute(
                select(DriverSubstitutionConfirmation.action_location_assessment).where(
                    DriverSubstitutionConfirmation.request_id == row.request_id,
                    DriverSubstitutionConfirmation.role == SubstitutionRole.INCOMING.value,
                )
            )).scalar_one_or_none()
            proximity = assessment.get("proximity") if isinstance(assessment, dict) else None
            reasons = transfer_review_reasons(row, proximity)
            if not reasons:
                return None
            outgoing_id, incoming_id = row.original_driver_id, row.substituting_driver_id
            names = dict((await db.execute(
                select(Driver.id, Driver.full_name).where(Driver.id.in_({outgoing_id, incoming_id}))
            )).tuples().all())
            exception_id = uuid.uuid4()
            # phase_event_id stays None: a handover is not a phase. exception_id on the substitution row is
            # legacy and frozen into an anchored commitment, so it is not set here.
            await register_exception(db, TripException(
                id=exception_id, trip_id=trip.id, exception_type=ExceptionType.DRIVER_SUBSTITUTION,
                source=ExceptionSource.SYSTEM, severity=TRANSFER_REVIEW_SEVERITY,
                review_status=initial_review_status(TRANSFER_REVIEW_SEVERITY),
                description=transfer_review_description(
                    names.get(outgoing_id, "the outgoing driver"), names.get(incoming_id, "the incoming driver"), reasons,
                ),
            ))
            await db.flush()
    except Exception:
        # A finding must never condition custody: the transfer is already recorded and stands.
        # Broad on purpose: any failure here, not only a DB one, would otherwise fail the handover.
        logger.exception("Driver transfer review exception not recorded for substitution=%s", row.id)
        return None
    enqueue_event(db, trip.operator_organization_id, TripEvent(
        id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(TRANSFER_REVIEW_SEVERITY),
    ))
    return exception_id
