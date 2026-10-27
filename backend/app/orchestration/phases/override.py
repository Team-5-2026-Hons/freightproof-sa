"""Dispatcher override of a phase the driver could not complete. Anchors its own PHASE_OVERRIDE
record, never the phase's own receipt type.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PhaseSequenceError, TripStateError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus, PhaseType, TripStatus,
)
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.loaders import _load_phase_event, _load_trip_for_dispatcher
from app.orchestration.phases.payloads import compute_override_canonical_payload_v2
from app.orchestration.phases.state import first_unresolved_earlier_phase, recompute_position
from app.orchestration.trips.detail import get_trip_detail
from app.orchestration.exceptions.review_policy import dispatcher_authored_review, initial_review_status
from app.schemas.trips import TripDetailResponse


async def override_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
    operator_organization_id: uuid.UUID, user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for ONE phase the driver physically cannot
    complete — lost phone, left the depot, device wiped, bound to a device that
    is gone. Without this, a single unreachable phase blocked every
    later phase forever (_gate_and_load's lower-sequence gate has no other exit).

    Lives here, not in trip_admin.py: it writes a PhaseEvent and must call
    recompute_position, both of which this module owns.

    Raises ResourceNotFoundError (404) if the trip doesn't exist/belongs to
    another org, or the phase_event doesn't belong to this trip. Raises
    TripStateError (409) on a trip that has already reached a terminal state, and
    PhaseSequenceError (409) if the row is already COMPLETED — a resolved row
    needs no override, and completed evidence must not be rewritable — or if an
    earlier phase in the plan is still unresolved.
    """
    trip = await _load_trip_for_dispatcher(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id, lock=True,
    )

    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(
            current_status=TripStatus(trip.status).value,
            attempted_action="override a phase on",
        )

    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if event.status not in (PhaseStatus.PENDING, PhaseStatus.IN_PROGRESS):
        raise PhaseSequenceError(f"phase status is '{PhaseStatus(event.status).value}'", "Override")

    earlier = await first_unresolved_earlier_phase(
        db, trip_id=trip_id, sequence_number=event.sequence_number,
    )
    if earlier is not None:
        raise PhaseSequenceError(f"the earlier '{earlier.value}' phase is still unresolved", "Override")

    event.status = PhaseStatus.OVERRIDDEN
    event.dispatcher_override_user_id = user_id
    event.dispatcher_override_note = note
    event.completed_at = event.completed_at or datetime.now(UTC)

    _anchor_phase(db, event=event, canonical_payload=compute_override_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id, phase_type=PhaseType(event.phase_type),
        override_user_id=user_id, override_note=note,
    ))

    await register_exception(db, TripException(
        trip_id=trip_id, phase_event_id=event.id,
        exception_type=ExceptionType.DISPATCHER_NOTE, source=ExceptionSource.DISPATCHER,
        severity=ExceptionSeverity.WARNING,
        **dispatcher_authored_review(user_id=user_id, at=datetime.now(UTC)),
        description=note,
    ))

    if event.phase_type == PhaseType.ARRIVAL:
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_UNVERIFIED, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            review_status=initial_review_status(ExceptionSeverity.WARNING),
            description=(
                "The seal was not inspected at arrival: a dispatcher overrode the "
                "arrival phase, so seal continuity for this leg cannot be verified."
            ),
        ))

    await recompute_position(db, trip)
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.PHASE_COMPLETED))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
