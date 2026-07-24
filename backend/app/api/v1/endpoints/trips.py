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

from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.blockchain.hedera import HederaServiceError, HederaTimeoutError
from app.core.exceptions import PPSyncError, ResourceNotFoundError, TripConflictError
from app.db.models.enums import DispatcherRole, TripStatus
from app.db.session import get_db
from app.orchestration.resource_service import get_trip_detail, list_trips
from app.orchestration.trip_service import create_trip, get_active_trip_for_driver
from app.schemas.people import DriverRead, UserRead
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
    except PPSyncError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Parcel Perfect sync failed: {exc.reason}",
        ) from exc
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
    except HederaTimeoutError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Blockchain anchoring timed out — the trip was not created. Please retry.",
        ) from exc
    except HederaServiceError as exc:
        logger.error("Hedera anchoring failed during trip creation: %s", exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail="Blockchain anchoring is unavailable — the trip was not created. Please retry.",
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
    "/me/active",
    response_model=TripDetailResponse | None,
    summary="Driver's current active trip",
)
async def get_my_active_trip_endpoint(
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse | None:
    return await get_active_trip_for_driver(db, driver_id=current_driver.id)


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
        detail = await get_trip_detail(
            db=db,
            trip_id=trip_id,
            operator_organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if current_user.role != DispatcherRole.ADMIN_DISPATCHER:
        detail = detail.model_copy(update={"blockchain_receipts": []})
    return detail
