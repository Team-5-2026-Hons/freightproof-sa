"""FastAPI router for trip lifecycle endpoints.

POST /trips  — create a new trip (Handshake 0).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.db.session import get_db
from app.orchestration.trip_service import create_trip
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips", tags=["trips"])


@router.post(
    "",
    response_model=TripDetailResponse,
    status_code=status.HTTP_201_CREATED,
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
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error during trip creation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc
