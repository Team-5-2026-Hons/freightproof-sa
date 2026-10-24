"""Auth router — dispatcher session endpoints. Login itself is handled by
Supabase Auth client-side; this is the only auth endpoint the API exposes.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.auth.profile import get_dispatcher_profile
from app.db.session import get_db
from app.schemas.people import DispatcherProfileRead, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=DispatcherProfileRead)
async def get_me(
    current_user: UserRead = Depends(get_current_dispatcher),
    db: AsyncSession = Depends(get_db),
) -> DispatcherProfileRead:
    """Return the authenticated dispatcher's profile; doubles as a session health-check."""
    return await get_dispatcher_profile(db, current_user)
