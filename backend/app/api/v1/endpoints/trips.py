"""FastAPI router for trip lifecycle endpoints.

POST /trips          — create a new trip (Handshake 0).
GET  /trips          — list trips for the dispatcher's organisation.
GET  /trips/{trip_id} — get full trip detail by ID.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.db.models.enums import TripStatus
from app.db.session import get_db
from app.orchestration.resource_service import get_trip_detail, list_trips
from app.orchestration.trip_service import create_trip
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse, TripListItemResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips", tags=["trips"])


@router.post(
    "",
    response_model=TripDetailResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create a new trip (Handshake 0)",
)
async def create_trip_endpoint(
    payload: TripCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """Idempotency: one active trip per order_number per operator org is enforced.
    A second POST with the same order_number returns 409 until the first trip is closed.
    The H0 HandshakeEvent (Trip Creation) is created atomically with the trip row.
    Journey lock hash is computed here and anchored to Hedera HCS asynchronously.
    """
    try:
        return await create_trip(db=db, payload=payload, current_user=current_user)
    except TripConflictError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error during trip creation")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc


@router.get(
    "",
    response_model=list[TripListItemResponse],
    summary="List trips for the dispatcher's organisation",
)
async def list_trips_endpoint(
    status: Annotated[list[TripStatus] | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripListItemResponse]:
    return await list_trips(
        db=db,
        operator_organization_id=current_user.organization_id,
        status_filter=status,
    )


@router.get(
    "/{trip_id}",
    response_model=TripDetailResponse,
    summary="Get full trip detail by ID",
)
async def get_trip_detail_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    try:
        return await get_trip_detail(
            db=db,
            trip_id=trip_id,
            operator_organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
