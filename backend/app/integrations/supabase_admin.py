"""Supabase Auth Admin API client.

Server-side only — requires SUPABASE_SERVICE_ROLE_KEY which must never reach
the browser. Used to provision Supabase Auth accounts for new drivers so that
their UUID satisfies the FK constraint drivers.id → auth.users(id).
"""

import logging
import uuid

import httpx

from app.core.config import settings
from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole

logger = logging.getLogger(__name__)


async def create_driver_auth_user(phone: str, full_name: str) -> uuid.UUID:
    """Create a Supabase Auth phone account for a new driver.

    Returns the Supabase UUID, which must be used as drivers.id to satisfy
    the FK constraint added by migration 0003 (fk_drivers_auth_id).

    Raises DuplicateResourceError if the phone number is already registered.
    Raises httpx.HTTPStatusError for unexpected Supabase API failures.
    """
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "phone": phone,
        "phone_confirm": True,
        "app_metadata": {"role": "driver"},
        "user_metadata": {"full_name": full_name},
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, json=payload, headers=headers)

    if response.status_code == 422:
        _masked = f"***{phone[-4:]}" if len(phone) >= 4 else "****"
        logger.warning("Supabase auth user already exists for phone=%s", _masked)
        raise DuplicateResourceError("Driver", "phone_number", phone)

    if not response.is_success:
        error_msg = response.json().get("msg") or response.json().get("message") or response.text
        logger.error(
            "Supabase admin API error status=%s body=%s", response.status_code, error_msg
        )
        raise ValueError(f"Could not create driver account: {error_msg}")

    auth_id = response.json()["id"]
    logger.info("Created Supabase auth user id=%s for new driver", auth_id)
    return uuid.UUID(auth_id)


async def create_dispatcher_auth_user(
    email: str,
    password: str,
    full_name: str,
    role: DispatcherRole,
) -> uuid.UUID:
    """Create a Supabase Auth email/password account for a dispatcher.

    `role` is written to app_metadata — the authority source read by
    get_current_dispatcher on every request — and must be `dispatcher` or
    `admin_dispatcher`. The returned UUID must be used as users.id so the
    dispatcher's public `users` row links to their auth identity.

    Raises DuplicateResourceError if the email is already registered.
    Raises ValueError for unexpected Supabase API failures.
    """
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        # Auto-confirm: dispatcher accounts are provisioned by staff, not self-registered,
        # so there is no email-verification step to wait on.
        "email_confirm": True,
        "app_metadata": {"role": role.value},
        "user_metadata": {"full_name": full_name},
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, json=payload, headers=headers)

    if response.status_code == 422:
        logger.warning("Supabase auth user already exists for email=%s", email)
        raise DuplicateResourceError("User", "email", email)

    if not response.is_success:
        error_msg = response.json().get("msg") or response.json().get("message") or response.text
        logger.error(
            "Supabase admin API error status=%s body=%s", response.status_code, error_msg
        )
        raise ValueError(f"Could not create dispatcher account: {error_msg}")

    auth_id = response.json()["id"]
    logger.info("Created Supabase auth user id=%s role=%s for new dispatcher", auth_id, role.value)
    return uuid.UUID(auth_id)
