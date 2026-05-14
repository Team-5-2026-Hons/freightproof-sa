"""FastAPI router for vehicle list endpoint.

GET /vehicles — returns all active vehicles (horses + trailers) for
the dispatcher's operator org. The frontend splits by vehicle_type.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_vehicles
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleRead

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get(
    "",
    response_model=list[VehicleRead],
    summary="List active vehicles (horses and trailers) for the dispatcher's organisation",
)
async def list_vehicles_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleRead]:
    return await list_vehicles(db=db, organization_id=current_user.organization_id)
