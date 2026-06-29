"""Driver checkpoint logging endpoint."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.checkpoint_service import log_checkpoint
from app.schemas.people import DriverRead
from app.schemas.transit import CheckpointRead, DriverCheckpointCreateBody

router = APIRouter(prefix="/trips/{trip_id}/checkpoints", tags=["checkpoints"])


@router.post("", response_model=CheckpointRead, status_code=http_status.HTTP_201_CREATED)
async def log_checkpoint_endpoint(
    trip_id: UUID,
    payload: DriverCheckpointCreateBody,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> CheckpointRead:
    try:
        return await log_checkpoint(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
