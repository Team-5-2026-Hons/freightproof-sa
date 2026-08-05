"""Driver location-trail endpoint.

The PWA posts here whenever the driver interacts with an open trip. Reads of the trail
(dispatcher-side map / evidence pack) are not part of this change — flagged, not
silently dropped.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.location_service import record_location_pings
from app.schemas.locations import LocationPingBatch, LocationPingBatchResult
from app.schemas.people import DriverRead

router = APIRouter(prefix="/trips/{trip_id}/locations", tags=["locations"])


@router.post("", response_model=LocationPingBatchResult, status_code=http_status.HTTP_201_CREATED)
async def record_locations_endpoint(
    trip_id: UUID,
    payload: LocationPingBatch,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> LocationPingBatchResult:
    try:
        recorded = await record_location_pings(
            db, trip_id=trip_id, driver_id=current_driver.id, pings=payload.pings,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return LocationPingBatchResult(recorded=recorded)
