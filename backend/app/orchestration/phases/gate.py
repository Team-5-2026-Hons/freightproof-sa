"""Loads a trip and phase event and checks the sequence gate before a phase may complete.
Includes the DB loading because the gate needs the trip, event and detail before it can
check order.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PhaseBlockedError, PhaseSequenceError
from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.phases.loaders import _load_phase_event, _load_trip_for_driver
from app.orchestration.phases.state import _is_resolved
from app.orchestration.resource_service import get_trip_detail
from app.schemas.trips import TripDetailResponse


async def _gate_and_load(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    phase_label: str,
) -> tuple[Trip, PhaseEvent] | TripDetailResponse:
    """Loads and validates the trip and phase event before completion. Returns
    (trip, event) to continue, or a TripDetailResponse if idempotent replay
    already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id, lock=True)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if _is_resolved(event.status):
        # Idempotent replay — COMPLETED, EXCEPTION, and OVERRIDDEN
        # are all "already decided" per _is_resolved's own predicate, matched here so a
        # replayed completion that landed in EXCEPTION — e.g. a resent
        # offline-queue entry for a seal mismatch — is caught here too,
        # instead of falling through to re-execute the wrapper body and
        # double-write evidence/exceptions on every resend). Checked BEFORE
        # the trip-status check below on purpose: a phase whose own
        # completion is what closed/held the trip (e.g. advance_confirmation's
        # count-mismatch branch, which sets EXCEPTION and lets the trip close)
        # must still replay as an idempotent 200 — not a 409 — even though
        # trip.status now reads CLOSED as a result of that same completion.
        # (CLOSED is the only status a completion can produce today; see
        # _is_resolved on why EXCEPTION_HOLD no longer occurs here.)
        # A genuinely new attempt at a still-PENDING phase on a
        # dead/held trip falls through to the trip-status check unaffected,
        # since _is_resolved(PENDING) is False.
        return await get_trip_detail(
            db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id,
        )

    # EXCEPTION_HOLD is listed but no production path sets it (see _is_resolved).
    # Kept deliberately so a manual dispatcher hold, when it lands, gates phase
    # completion by construction rather than needing this check re-derived — and
    # the behaviour stays covered meanwhile by
    # test_phases.py::test_activation_complete_wrong_state_returns_409, which sets
    # the status directly. Do not read its presence here as evidence that some
    # mismatch still holds a trip: none does.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD):
        # Trip.status is a plain String(30) column: a freshly DB-loaded trip
        # (every real request — get_db() hands out a fresh session per call)
        # yields a raw str here, not the TripStatus enum, so `.value` alone
        # would crash on the single most common path to this branch.
        # TripStatus(...) normalises either shape before reading .value.
        raise PhaseSequenceError(f"trip status is '{TripStatus(trip.status).value}'", phase_label)

    # No phase-type exclusion here. IN_TRANSIT used to be skipped, and had to be: since it
    # stopped auto-completing on departure it stayed PENDING for the whole drive at a LOWER
    # sequence than the arrival phase, so gating on it made advance_unloading unreachable —
    # the call was rejected here, hundreds of lines before the branch that closed the row.
    # The trip could never leave the driving leg.
    #
    # The exclusion went away with its cause (2026-08-09): in_transit is now closed by the
    # driver's own arrival submission (advance_in_transit), at its own sequence position,
    # so the ordinary ordering rule covers it and a PENDING in_transit correctly blocks an
    # unloading — an arrival that was never attested to is exactly the gap this platform
    # exists to surface. A driver who cannot submit it (dead phone) is recovered by the
    # dispatcher's in_transit override, which resolves the row through the normal path.
    lower_result = await db.execute(
        select(PhaseEvent.status).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.sequence_number < event.sequence_number,
        )
    )
    if any(not _is_resolved(PhaseStatus(status)) for (status,) in lower_result.all()):
        # trip.status is usually just ACTIVE/CREATED here — it isn't the real
        # blocker, an unresolved earlier phase is, so the message says that
        # instead of misleadingly implying trip.status caused the 409.
        raise PhaseSequenceError("an earlier phase in the plan is still unresolved", phase_label)

    # AFTER the _is_resolved replay short-circuit above, never before it. A resent
    # offline-queue entry for an already-successful completion must return current
    # state, not 409 — otherwise the driver app's queue never drains. This ordering
    # is covered by test_an_idempotent_replay_of_a_completed_phase_does_not_409.
    if event.trip_stop_id is not None:
        gate = await blocked_on_by_stop(db, trip_id=trip_id)
        if gate.get((PhaseType(event.phase_type), event.trip_stop_id)) is not None:
            raise PhaseBlockedError(phase_label)

    return trip, event
