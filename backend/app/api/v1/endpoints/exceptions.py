"""Driver-raised exception endpoint. Dispatcher list/resolve/override (spec §3.6)
are out of scope for this plan — flagged, not silently dropped."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.exception_service import raise_exception
from app.schemas.people import DriverRead
from app.schemas.transit import DriverExceptionCreateBody, TripExceptionRead

router = APIRouter(prefix="/trips/{trip_id}/exceptions", tags=["exceptions"])


@router.post("", response_model=TripExceptionRead, status_code=http_status.HTTP_201_CREATED)
async def raise_exception_endpoint(
    trip_id: UUID,
    payload: DriverExceptionCreateBody,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripExceptionRead:
    try:
        return await raise_exception(
            db, trip_id=trip_id, driver_id=current_driver.id,
            exception_type=payload.exception_type, description=payload.description,
            supporting_artifact_id=payload.supporting_artifact_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
