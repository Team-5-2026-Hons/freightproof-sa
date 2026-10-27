"""Phase plan endpoints — the frozen contract's HTTP surface.

Replaces endpoints/handshakes.py and its five /h{n}/complete routes. These routes
are driver-scoped. The dispatcher reads the same plan through
TripDetailResponse.phases on GET /trips/{id}, which it already calls — giving
these routes a second auth path would be new security surface with no consumer.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.api.v1.custody_errors import custody_http_exception
from app.core.exceptions import (
    CustodyAccessError,
    EvidenceAttributionError,
    PhaseBlockedError,
    PhaseSequenceError,
    PhaseTooEarlyError,
    PhaseTypeMismatchError,
    ResourceNotFoundError,
    TripActivationBlockedError,
)
from app.core.limits import EVIDENCE_WRITE
from app.core.rate_limit import rate_limit
from app.db.errors import DatabaseUnavailableError
from app.db.session import get_db
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.evidence.location_assessment import (
    PhaseLocationPreviewConflictError,
    preview_phase_location,
)
from app.orchestration.phases.queries import list_phases, next_phase, stop_sequence_map
from app.orchestration.phases.service import complete_phase
from app.schemas.action_location import ActionLocationAssessment, DriverLocationCapture
from app.schemas.people import DriverRead
from app.schemas.phases import PhaseCompleteRequest, PhaseEventRead
from app.schemas.trips import TripDetailResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/phases", tags=["phases"])


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
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc
    stop_sequences = await stop_sequence_map(db, trip_id=trip_id)
    gate = await blocked_on_by_stop(db, trip_id=trip_id)
    return [
        PhaseEventRead.from_event(
            e, stop_sequence_by_id=stop_sequences, blocked_on_by_stop=gate,
        )
        for e in events
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
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc
    if event is None:
        return None
    stop_sequences = await stop_sequence_map(db, trip_id=trip_id)
    gate = await blocked_on_by_stop(db, trip_id=trip_id)
    return PhaseEventRead.from_event(
        event, stop_sequence_by_id=stop_sequences, blocked_on_by_stop=gate,
    )


@router.post(
    "/{phase_event_id}/location-preview",
    response_model=ActionLocationAssessment,
    summary="Compare a fresh phone capture with the vehicle tracker without recording evidence",
    dependencies=[Depends(rate_limit(EVIDENCE_WRITE))],
)
async def preview_phase_location_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    payload: DriverLocationCapture,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> ActionLocationAssessment:
    try:
        return await preview_phase_location(
            db, trip_id=trip_id, driver_id=current_driver.id,
            phase_event_id=phase_event_id, capture=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseLocationPreviewConflictError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc


@router.post(
    "/{phase_event_id}/complete",
    response_model=TripDetailResponse,
    summary="Complete a phase (idempotent by idempotency_key)",
    dependencies=[Depends(rate_limit(EVIDENCE_WRITE))],
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
    anchor failed (fail-open — dispatchers see anchor_status='failed', not a 504).
    """
    try:
        return await complete_phase(
            db, trip_id=trip_id, driver_id=current_driver.id,
            phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc
    except (
        PhaseSequenceError, PhaseTooEarlyError, PhaseTypeMismatchError,
        TripActivationBlockedError, PhaseBlockedError,
    ) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except EvidenceAttributionError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except DatabaseUnavailableError:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error during phase completion")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc
