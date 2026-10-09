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
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.loaders import _load_phase_event, _load_trip_for_dispatcher
from app.orchestration.phases.payloads import compute_override_canonical_payload_v2
from app.orchestration.phases.state import recompute_position
from app.orchestration.resource_service import get_trip_detail
from app.orchestration.review_policy import dispatcher_authored_review, initial_review_status
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
    needs no override, and completed evidence must not be rewritable.
    """
    trip = await _load_trip_for_dispatcher(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id, lock=True,
    )

    # A terminal trip is not overridable, and this guard is load-bearing rather
    # than defensive. cancel_trip deliberately leaves every phase row PENDING —
    # that is the honest record of a plan abandoned partway through — so on a
    # CANCELLED trip every row still looks overridable. recompute_position()
    # below ends with an UNCONDITIONAL trip.status = CLOSED once nothing is
    # unresolved, so overriding the last pending row of a cancelled trip would
    # silently rewrite CANCELLED as CLOSED and destroy the terminal fact the
    # cancellation recorded. complete_phase never hits this because it goes
    # through _gate_and_load, which already checks trip status; override_phase
    # deliberately does not use that driver-scoped gate, so it needs its own.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(
            current_status=TripStatus(trip.status).value,
            attempted_action="override a phase on",
        )

    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if event.status not in (PhaseStatus.PENDING, PhaseStatus.IN_PROGRESS):
        # Matches PhaseSequenceError's existing vocabulary ("cannot complete X:
        # reason") rather than inventing a new exception type for one more state
        # check — the reason clause just names the row's real status.
        raise PhaseSequenceError(f"phase status is '{PhaseStatus(event.status).value}'", "Override")

    event.status = PhaseStatus.OVERRIDDEN
    event.dispatcher_override_user_id = user_id
    event.dispatcher_override_note = note
    # Dated even though not completed. `status` already carries the "this
    # didn't really happen" truth — an undated row in the dispatcher's
    # chronological timeline (which reads completed_at for its card timestamp)
    # is a worse lie than a dated one. Mirrors _finish_phase's own
    # `event.completed_at = event.completed_at or now()` above.
    event.completed_at = event.completed_at or datetime.now(UTC)

    # Revised 2026-09-23: the override itself is anchored, with its own
    # PHASE_OVERRIDE receipt type. An override is exactly what a dispute questions, so
    # who did it, to which phase and why must be as tamper-evident as a driver's
    # completion. It used to leave anchor_status PENDING forever, so the gap read as a
    # receipt still owed. The gap is now carried honestly by status OVERRIDDEN and by
    # the receipt type, which can never be mistaken for the phase's own receipt
    # (receipt_type_for). No driver evidence is claimed: the payload commits only to
    # the override record, and the note (free text) only as a keyed hash.
    _anchor_phase(db, event=event, canonical_payload=compute_override_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id, phase_type=PhaseType(event.phase_type),
        override_user_id=user_id, override_note=note,
    ))

    # The human intervention lands on the ledger, not just in an audit column.
    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        exception_type=ExceptionType.DISPATCHER_NOTE, source=ExceptionSource.DISPATCHER,
        severity=ExceptionSeverity.WARNING,
        **dispatcher_authored_review(user_id=user_id, at=datetime.now(UTC)),
        description=note,
    ))

    if event.phase_type == PhaseType.ARRIVAL:
        # The seal check lives in advance_arrival, so overriding arrival skips it and
        # nothing downstream would notice. Record the gap on the leg itself. WARNING,
        # not CRITICAL, for the same reason an overridden departure's missing seal is
        # WARNING in advance_arrival: the absence is explained by an authorised action
        # that is already on the ledger as the DISPATCHER_NOTE above.
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

    # May legitimately CLOSE the trip if this was the last unresolved row — that
    # is correct and must not be special-cased; _is_resolved already treats
    # OVERRIDDEN as resolved for gating purposes.
    await recompute_position(db, trip)
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    # Always PHASE_COMPLETED for an override — the plan position moved, same
    # refetch as any completion (unlike _finish_phase, this is not conditional on
    # the trip closing; that distinction belongs to cancel_trip's TRIP_CLOSED).
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.PHASE_COMPLETED))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
