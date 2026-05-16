"""FastAPI router for driver endpoints.

GET  /drivers — list active drivers for the dispatcher's organisation.
POST /drivers — register a new driver under the dispatcher's organisation.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import DuplicateResourceError
from app.db.session import get_db
from app.orchestration.resource_service import create_driver, list_drivers
from app.schemas.people import DriverCreateBody, DriverRead, UserRead

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get(
    "",
    response_model=list[DriverRead],
    summary="List active drivers for the dispatcher's organisation",
)
async def list_drivers_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DriverRead]:
    return await list_drivers(db=db, organization_id=current_user.organization_id)


@router.post(
    "",
    response_model=DriverRead,
    status_code=201,
    summary="Register a new driver under the dispatcher's organisation",
)
async def create_driver_endpoint(
    body: DriverCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverRead:
    try:
        return await create_driver(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
