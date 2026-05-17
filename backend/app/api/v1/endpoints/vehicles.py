"""FastAPI router for vehicle endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.resource_service import (
    create_vehicle, get_vehicle_detail, list_vehicles, update_vehicle,
)
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleCreateBody, VehicleDetailResponse, VehicleRead, VehicleUpdateBody

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehicleRead])
async def list_vehicles_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleRead]:
    return await list_vehicles(db=db, organization_id=current_user.organization_id)


@router.post("", response_model=VehicleRead, status_code=201)
async def create_vehicle_endpoint(
    body: VehicleCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
    try:
        return await create_vehicle(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.patch("/{vehicle_id}", response_model=VehicleRead)
async def update_vehicle_endpoint(
    vehicle_id: UUID,
    body: VehicleUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
    try:
        return await update_vehicle(
            db=db,
            vehicle_id=vehicle_id,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{vehicle_id}", response_model=VehicleDetailResponse)
async def get_vehicle_detail_endpoint(
    vehicle_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleDetailResponse:
    try:
        return await get_vehicle_detail(
            db=db,
            vehicle_id=vehicle_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
