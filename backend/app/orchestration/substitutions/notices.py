"""Durable in-app notices for a handover (FP-83 C3).

A notice is a row, written in the same transaction as the lifecycle change it announces, so a
rollback leaves none and a client that missed the realtime ping recovers it by fetching. This
module does no HTTP and no push; delivery routes are C6. Reading a notice is never a
confirmation (see DriverSubstitutionNotice).
"""

import uuid
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionNotice, DriverSubstitutionRequest
from app.schemas.driver_substitutions import SubstitutionNoticeKind


async def notify_parties(
    db: AsyncSession, *, request: DriverSubstitutionRequest, kind: SubstitutionNoticeKind,
) -> None:
    """One notice of `kind` to each of the request's two drivers."""
    await write_notices(
        db, request_id=request.id, kind=kind,
        recipient_driver_ids=(request.outgoing_driver_id, request.incoming_driver_id),
    )


async def write_notices(
    db: AsyncSession, *, request_id: uuid.UUID, kind: SubstitutionNoticeKind,
    recipient_driver_ids: Iterable[uuid.UUID],
) -> None:
    """Insert one notice per distinct recipient. The unique (recipient, request, kind) key
    makes a duplicate a loud error rather than a second notice."""
    db.add_all(
        DriverSubstitutionNotice(recipient_driver_id=driver_id, request_id=request_id, kind=kind.value)
        for driver_id in dict.fromkeys(recipient_driver_ids)
    )
    await db.flush()
