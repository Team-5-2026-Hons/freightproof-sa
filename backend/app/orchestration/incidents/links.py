"""Grouping an exception under an incident and naming a parcel as affected. Shared by the report
(creation) and by follow-up (updates), so both write the link row and its ledger entry together.
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExceptionAlreadyInIncidentError
from app.db.models.enums import IncidentUpdateKind
from app.db.models.incidents import IncidentException, IncidentParcel
from app.orchestration.incidents.ledger import Entry, OpenLedger, append


async def link_exception(
    db: AsyncSession, ledger: OpenLedger, *, exception_id: uuid.UUID, entry: Entry,
) -> None:
    """The caller has checked the exception is on the trip and unlinked. The flush runs in a
    savepoint because the incident lock does not cover a colleague linking the same exception
    to a DIFFERENT incident at the same instant; the unique constraint catches that race, and
    the savepoint turns it into the same 409 the pre-check gives instead of a dead transaction."""
    link = IncidentException(
        id=uuid.uuid4(), incident_id=ledger.incident.id, exception_id=exception_id,
        linked_by_user_id=entry.user_id, created_at=entry.at, updated_at=entry.at,
    )
    try:
        async with db.begin_nested():
            db.add(link)
            await db.flush()
    except IntegrityError as exc:
        holder = (await db.execute(
            select(IncidentException.incident_id).where(IncidentException.exception_id == exception_id)
        )).scalar_one()
        raise ExceptionAlreadyInIncidentError(exception_id=exception_id, incident_id=holder) from exc
    append(db, ledger, entry)


def add_parcel(db: AsyncSession, ledger: OpenLedger, *, parcel_id: uuid.UUID, user_id: uuid.UUID, at: datetime) -> None:
    db.add(IncidentParcel(
        id=uuid.uuid4(), incident_id=ledger.incident.id, parcel_id=parcel_id,
        added_by_user_id=user_id, created_at=at, updated_at=at,
    ))
    append(db, ledger, Entry(kind=IncidentUpdateKind.PARCEL_ADDED, user_id=user_id, at=at, parcel_id=parcel_id))
