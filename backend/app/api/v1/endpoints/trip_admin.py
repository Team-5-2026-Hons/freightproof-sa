"""Dispatcher-only trip lifecycle exits — the two dead-end closers (task 6.1):

POST /trips/{trip_id}/cancel
POST /trips/{trip_id}/phases/{phase_event_id}/override

Kept out of trips.py and phases.py deliberately. phases.py is driver-scoped by
decision S3 ("giving these routes a second auth path would be new security
surface with no consumer") — override is dispatcher-only, so putting it there
would mix two auth audiences into one file, exactly what S3 protects against.
trips.py stays the create/read surface; these are the two write actions that
close a dead end rather than advance the plan.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import PhaseSequenceError, ResourceNotFoundError, TripStateError
from app.db.session import get_db
from app.orchestration.phase_service import override_phase
from app.orchestration.trip_service import cancel_trip
from app.schemas.people import UserRead
from app.schemas.trips import CancelTripRequest, OverridePhaseRequest, TripDetailResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip-admin"])


@router.post(
    "/cancel",
    response_model=TripDetailResponse,
    summary="Cancel a trip (dispatcher-only terminal exit)",
)
async def cancel_trip_endpoint(
    trip_id: UUID,
    payload: CancelTripRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """A trip abandoned mid-plan (cargo pulled, vehicle broken down) has no other
    exit — phase rows are left exactly as they are (evidence, not completion)."""
    try:
        return await cancel_trip(
            db, trip_id=trip_id, operator_organization_id=current_user.organization_id,
            user_id=current_user.id, note=payload.note,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except TripStateError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error cancelling trip_id=%s", trip_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc


@router.post(
    "/phases/{phase_event_id}/override",
    response_model=TripDetailResponse,
    summary="Override a phase the driver cannot complete (dispatcher-only)",
)
async def override_phase_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    payload: OverridePhaseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """A phase the driver physically cannot complete (lost phone, left the depot,
    device wiped) otherwise blocks every later phase forever — this is its only
    release valve, and it records itself as a TripException on the ledger."""
    try:
        return await override_phase(
            db, trip_id=trip_id, phase_event_id=phase_event_id,
            operator_organization_id=current_user.organization_id,
            user_id=current_user.id, note=payload.note,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (TripStateError, PhaseSequenceError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error overriding phase_event_id=%s", phase_event_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc
