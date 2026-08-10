"""FastAPI router for precinct list endpoint.

GET /precincts — precincts owned by the caller's organization plus any
precinct marked is_shared (origin/destination gates).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_precincts
from app.schemas.organisations import PrecinctRead
from app.schemas.people import UserRead

router = APIRouter(prefix="/precincts", tags=["precincts"])


@router.get(
    "",
    response_model=list[PrecinctRead],
    summary="List the caller's organization's physical depots and warehouses, plus shared precincts",
)
async def list_precincts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PrecinctRead]:
    return await list_precincts(db=db, organization_id=current_user.organization_id)
