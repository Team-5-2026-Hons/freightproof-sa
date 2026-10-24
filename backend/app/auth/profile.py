"""The authenticated dispatcher's own profile, as the portal shows it."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.organisations import Organization
from app.schemas.people import DispatcherProfileRead, UserRead


async def get_dispatcher_profile(db: AsyncSession, user: UserRead) -> DispatcherProfileRead:
    """The dispatcher's profile with their organisation's name.

    scalar_one, not scalar_one_or_none: users.organization_id is a foreign key, so a missing
    organisation is a broken invariant that should surface as an error, not as a blank name.
    """
    organization_name = (await db.execute(
        select(Organization.name).where(Organization.id == user.organization_id)
    )).scalar_one()

    return DispatcherProfileRead(**user.model_dump(), organization_name=organization_name)
