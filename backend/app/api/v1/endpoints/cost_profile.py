"""FastAPI router for the Cost tab's rates (FP-294).

GET   /analytics/cost-profile  the rates the caller's organisation's cost figures use
PATCH /analytics/cost-profile  change some or all of them. Admin dispatcher only.

Any dispatcher may read the rates, because every cost figure on the tab depends on them
(provenance); only an admin may change them. The organisation always comes from the
token, never from the request. Mounted on the analytics router, so main.py needs no change.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
from app.core.limits import COST_PROFILE_MUTATION
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.orchestration.analytics.cost_profile import read_cost_profile, update_cost_profile
from app.schemas.cost_analytics import CostProfileRead, CostProfileUpdate
from app.schemas.people import UserRead

router = APIRouter(prefix="/cost-profile", tags=["analytics"])


@router.get(
    "",
    response_model=CostProfileRead,
    summary="The cost rates the organisation's cost figures use",
)
async def get_cost_profile_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> CostProfileRead:
    return await read_cost_profile(db, organization_id=current_user.organization_id)


@router.patch(
    "",
    response_model=CostProfileRead,
    summary="Change the organisation's cost rates (admin dispatcher only)",
    dependencies=[Depends(rate_limit(COST_PROFILE_MUTATION))],
)
async def update_cost_profile_endpoint(
    body: CostProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> CostProfileRead:
    return await update_cost_profile(
        db, organization_id=current_user.organization_id, data=body, user_id=current_user.id,
    )
