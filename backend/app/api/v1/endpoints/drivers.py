"""FastAPI router for driver endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import (
    get_current_dispatcher,
    get_current_driver,
    require_admin_dispatcher,
)
from app.db.models.enums import DispatcherRole
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.driver_service import (
    list_drivers, create_driver, update_driver, get_driver_detail,
)
from app.schemas.people import (
    DriverCreateBody, DriverDetailResponse, DriverRead, DriverUpdateBody, UserRead,
)

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get("", response_model=list[DriverRead])
async def list_drivers_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DriverRead]:
    return await list_drivers(db=db, organization_id=current_user.organization_id)


@router.get("/me", response_model=DriverRead)
async def get_my_driver_profile(
    current_driver: DriverRead = Depends(get_current_driver),
) -> DriverRead:
    """Return the authenticated driver's own profile.

    The driver-pwa frontend calls this after Supabase verifyOtp() succeeds to
    confirm the session and load the driver record for the app shell.
    """
    return current_driver


@router.post("", response_model=DriverRead, status_code=201)
async def create_driver_endpoint(
    body: DriverCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
    try:
        return await create_driver(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.patch("/{driver_id}", response_model=DriverRead)
async def update_driver_endpoint(
    driver_id: UUID,
    body: DriverUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
    try:
        return await update_driver(
            db=db,
            driver_id=driver_id,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{driver_id}", response_model=DriverDetailResponse)
async def get_driver_detail_endpoint(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverDetailResponse:
    try:
        detail = await get_driver_detail(
            db=db,
            driver_id=driver_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if current_user.role != DispatcherRole.ADMIN_DISPATCHER:
        detail = detail.model_copy(update={"receipts": []})
    return detail
