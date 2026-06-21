"""Auth router — dispatcher session endpoints.

GET /auth/me  returns the current dispatcher's profile.

The frontend calls this after a Supabase sign-in to confirm the session is
valid against our users table and to fetch the dispatcher's name + org for
the UI shell. It is the only auth endpoint we expose — login itself is
handled entirely by Supabase Auth on the client side.
"""

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_dispatcher
from app.schemas.people import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=UserRead)
async def get_me(current_user: UserRead = Depends(get_current_dispatcher)) -> UserRead:
    """Return the authenticated dispatcher's profile.

    The frontend uses this as a session health-check on load — if it returns
    200 the stored token is still valid; if it returns 401 the user is sent
    back to the login page.
    """
    return current_user
