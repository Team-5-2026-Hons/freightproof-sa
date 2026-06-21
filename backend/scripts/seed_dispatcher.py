"""Provision a real (non-DEMO_MODE) dispatcher account end-to-end.

Creates a Supabase Auth user (email/password) carrying the dispatcher role in
app_metadata, then inserts the matching public `users` row linked by UUID so
that get_current_dispatcher can resolve the account. Run once per account.

Usage (run as a module from the backend root so `app` is importable):
    cd backend
    python -m scripts.seed_dispatcher \
        --email admin@operator.co.za \
        --name "Admin Dispatcher" \
        --org <ORGANIZATION_UUID> \
        --role admin_dispatcher
    # Password: pass --password, set DISPATCHER_SEED_PASSWORD, or enter at the prompt.
"""

import argparse
import asyncio
import getpass
import os
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.integrations.supabase_admin import create_dispatcher_auth_user

# Env var checked for the password when --password is omitted, before prompting.
_PASSWORD_ENV_VAR = "DISPATCHER_SEED_PASSWORD"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provision a dispatcher account (Supabase Auth user + public users row).",
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="Full name")
    parser.add_argument("--org", required=True, help="Organization UUID the dispatcher belongs to")
    parser.add_argument(
        "--role",
        choices=[r.value for r in DispatcherRole],
        default=DispatcherRole.DISPATCHER.value,
    )
    parser.add_argument(
        "--password",
        default=None,
        help=f"Account password. Or set ${_PASSWORD_ENV_VAR}, or enter at the prompt.",
    )
    return parser.parse_args()


def _resolve_password(cli_password: str | None) -> str:
    """Resolve the password without ever hardcoding it: flag, then env, then prompt."""
    password = cli_password or os.environ.get(_PASSWORD_ENV_VAR) or getpass.getpass("Dispatcher password: ")
    if not password:
        raise SystemExit("A password is required.")
    return password


async def seed_dispatcher(
    email: str,
    full_name: str,
    org_id: uuid.UUID,
    role: DispatcherRole,
    password: str,
) -> None:
    # DEMO_MODE bypasses auth entirely with a fixed stub user, so real accounts are pointless there.
    if settings.DEMO_MODE:
        raise SystemExit("DEMO_MODE is enabled; real dispatcher accounts only apply when DEMO_MODE=False.")

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as db:
            # Guard: users.organization_id is a NOT NULL FK — the org must already exist.
            org = await db.execute(select(Organization).where(Organization.id == org_id))
            if org.scalar_one_or_none() is None:
                raise SystemExit(f"No organization with id {org_id}. Provide an existing organizations.id.")

            # Guard: users.email is unique — don't attempt a duplicate row.
            existing = await db.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none() is not None:
                raise SystemExit(f"A users row already exists for {email}. Aborting.")

            # 1) Supabase Auth account — carries the role claim; returns the UUID we link to.
            try:
                auth_id = await create_dispatcher_auth_user(
                    email=email, password=password, full_name=full_name, role=role,
                )
            except DuplicateResourceError:
                raise SystemExit(
                    f"{email} already exists in Supabase Auth. "
                    "Delete it in the dashboard or use a different email."
                )

            # 2) Public users row, linked by UUID so get_current_dispatcher resolves it.
            db.add(User(
                id=auth_id,
                organization_id=org_id,
                email=email,
                full_name=full_name,
                is_active=True,
            ))
            await db.commit()
    finally:
        await engine.dispose()

    print(f"Created {role.value}: {email} (id={auth_id}, org={org_id})")


def main() -> None:
    args = _parse_args()
    try:
        org_id = uuid.UUID(args.org)
    except ValueError:
        raise SystemExit(f"--org must be a valid UUID, got: {args.org}")

    asyncio.run(seed_dispatcher(
        email=args.email,
        full_name=args.name,
        org_id=org_id,
        role=DispatcherRole(args.role),
        password=_resolve_password(args.password),
    ))


if __name__ == "__main__":
    main()
