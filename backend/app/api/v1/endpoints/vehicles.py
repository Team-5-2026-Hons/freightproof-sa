"""FastAPI router for vehicle endpoints.

GET  /vehicles — list active vehicles (horses + trailers) for the dispatcher's org.
POST /vehicles — register a new vehicle under the dispatcher's organisation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import create_vehicle, list_vehicles
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleCreateBody, VehicleRead

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


@router.post(
    "",
    response_model=VehicleRead,
    status_code=201,
    summary="Register a new vehicle under the dispatcher's organisation",
)
async def create_vehicle_endpoint(
    body: VehicleCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
    return await create_vehicle(
        db=db,
        organization_id=current_user.organization_id,
        data=body,
    )
