"""Phase plan endpoints — the frozen contract's HTTP surface (parent plan §3.2).

Replaces endpoints/handshakes.py and its five /h{n}/complete routes. Decision S3:
these are driver-scoped. The dispatcher reads the same plan through
TripDetailResponse.phases on GET /trips/{id}, which it already calls — giving
these routes a second auth path would be new security surface with no consumer.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import (
    PhaseSequenceError,
    PhaseTooEarlyError,
    PhaseTypeMismatchError,
    ResourceNotFoundError,
)
from app.db.models.trips import TripStop
from app.db.session import get_db
from app.orchestration.phase_service import complete_phase, list_phases, next_phase
from app.schemas.people import DriverRead
from app.schemas.phases import PhaseCompleteRequest, PhaseEventRead
from app.schemas.trips import TripDetailResponse

router = APIRouter(prefix="/trips/{trip_id}/phases", tags=["phases"])


async def _stop_sequence_map(db: AsyncSession, *, trip_id: UUID) -> dict[UUID, int]:
    """PhaseEventRead.stop_sequence is a join, not a column — see its docstring."""
    result = await db.execute(
        select(TripStop.id, TripStop.sequence).where(TripStop.trip_id == trip_id)
    )
    return {stop_id: sequence for stop_id, sequence in result.all()}


@router.get("", response_model=list[PhaseEventRead], summary="A trip's committed phase plan")
async def list_phases_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> list[PhaseEventRead]:
    try:
        events = await list_phases(db, trip_id=trip_id, driver_id=current_driver.id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    return [
        PhaseEventRead.from_event(e, stop_sequence_by_id=stop_sequences) for e in events
    ]


@router.get(
    "/next",
    response_model=PhaseEventRead | None,
    summary="The next unresolved phase, or null on a closed trip",
)
async def next_phase_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> PhaseEventRead | None:
    try:
        event = await next_phase(db, trip_id=trip_id, driver_id=current_driver.id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if event is None:
        return None
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    return PhaseEventRead.from_event(event, stop_sequence_by_id=stop_sequences)


@router.post(
    "/{phase_event_id}/complete",
    response_model=TripDetailResponse,
    summary="Complete a phase (idempotent by idempotency_key)",
)
async def complete_phase_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    payload: PhaseCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """Always 200 on a successful completion, including when the phase records a
    mismatch (that is evidence, not a client error) and including when its Hedera
    anchor failed (fail-open, D7 — dispatchers see anchor_status='failed', not a 504).
    """
    try:
        return await complete_phase(
            db, trip_id=trip_id, driver_id=current_driver.id,
            phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (PhaseSequenceError, PhaseTooEarlyError, PhaseTypeMismatchError) as exc:
        # PhaseTooEarlyError joins the 409 family rather than getting a status of its own:
        # like the others it means "the request is well-formed, the trip's state says no".
        # Its detail string is written to be read by the driver, and the PWA surfaces it
        # verbatim, so the date reaches the person who needs it.
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
