"""FastAPI router for driver list endpoint.

GET /drivers — list active drivers for the dispatcher's operator org.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_drivers
from app.schemas.people import DriverRead, UserRead

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
