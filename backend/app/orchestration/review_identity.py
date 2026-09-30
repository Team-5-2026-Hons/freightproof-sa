"""Display names for the dispatchers who claimed and reviewed an exception (FP-280).

A leaf module (no other orchestration imports) so exception_service and
resource_service can both use it: resource_service cannot import exception_service,
which imports phase_service, which imports resource_service.

Scoped to the caller's organisation, like every read here: a user id from anywhere
else resolves to no name rather than to another operator's staff member.
"""

import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.people import User
from app.schemas.transit import TripExceptionRead


async def user_names(
    db: AsyncSession, *, organization_id: uuid.UUID, user_ids: Iterable[uuid.UUID | None],
) -> dict[uuid.UUID, str]:
    ids = {user_id for user_id in user_ids if user_id is not None}
    if not ids:
        return {}
    rows = await db.execute(
        select(User.id, User.full_name).where(User.id.in_(ids), User.organization_id == organization_id)
    )
    return {user_id: name for user_id, name in rows.tuples().all()}


def name_of(names: Mapping[uuid.UUID, str], user_id: uuid.UUID | None) -> str | None:
    return None if user_id is None else names.get(user_id)


async def with_reviewer_names(
    db: AsyncSession, *, organization_id: uuid.UUID, reads: Sequence[TripExceptionRead],
) -> list[TripExceptionRead]:
    """One query for the whole list, not one per row."""
    names = await user_names(
        db, organization_id=organization_id,
        user_ids=[uid for read in reads for uid in (read.claimed_by_user_id, read.reviewed_by_user_id)],
    )
    return [
        read.model_copy(update={
            "claimed_by_name": name_of(names, read.claimed_by_user_id),
            "reviewed_by_name": name_of(names, read.reviewed_by_user_id),
        })
        for read in reads
    ]
