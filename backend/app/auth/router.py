"""Auth router — dispatcher session endpoints. Login itself is handled by
Supabase Auth client-side; this is the only auth endpoint the API exposes.
"""

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_dispatcher
from app.schemas.people import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=UserRead)
async def get_me(current_user: UserRead = Depends(get_current_dispatcher)) -> UserRead:
    """Return the authenticated dispatcher's profile; doubles as a session health-check."""
    return current_user
