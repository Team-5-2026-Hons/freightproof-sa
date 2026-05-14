"""FastAPI router for precinct list endpoint.

GET /precincts — all precincts (origin/destination gates).
Iteration 1: not yet scoped to the operator's client orgs.
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
    summary="List all physical depots and warehouses (precincts)",
)
async def list_precincts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PrecinctRead]:
    return await list_precincts(db=db)
