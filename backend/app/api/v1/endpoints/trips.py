"""FastAPI router for trip lifecycle endpoints.

POST /trips  — create a new trip (Handshake 0).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.db.session import get_db
from app.orchestration.trip_service import create_trip
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse

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
    """Create a trip by linking driver, horse, trailer(s), and order number.

    Returns the full TripDetailResponse including the H0 HandshakeEvent.
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
