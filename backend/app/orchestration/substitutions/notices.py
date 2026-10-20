"""Durable in-app notices for a handover (FP-83 C3, delivery C6).

A notice is a row, written in the same transaction as the lifecycle change it announces, so a
rollback leaves none and a client that missed the realtime ping recovers it by fetching. There
is no push (outside v1): the driver app polls and refetches on foreground/reconnect. Reading a
notice is never a confirmation and never moves custody (see DriverSubstitutionNotice).

Each notice batch also queues one thin org-scoped realtime event so the dispatcher's screen
refetches; it rides the transaction-aware outbox, so a rollback or savepoint publishes nothing.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.realtime import EventSeverity, RealtimeKind, TripEvent, enqueue_event
from app.db.models.driver_substitutions import DriverSubstitutionNotice, DriverSubstitutionRequest
from app.db.models.trips import Trip
from app.schemas.driver_substitutions import SubstitutionNoticeKind, SubstitutionNoticeRead

# A bounded newest-first page: the app only ever shows recent notices, and an unbounded list
# would grow with every handover a long-serving driver was ever named on.
NOTICE_PAGE_LIMIT = 50


async def notify_parties(
    db: AsyncSession, *, request: DriverSubstitutionRequest, kind: SubstitutionNoticeKind,
) -> None:
    """One notice of `kind` to each of the request's two drivers, and a dispatcher refetch ping."""
    await write_notices(
        db, request_id=request.id, kind=kind,
        recipient_driver_ids=(request.outgoing_driver_id, request.incoming_driver_id),
    )
    organization_id = (await db.execute(
        select(Trip.operator_organization_id).where(Trip.id == request.trip_id)
    )).scalar_one()
    enqueue_event(db, organization_id, TripEvent(
        id=request.trip_id, kind=RealtimeKind.DRIVER_SUBSTITUTION_CHANGED, severity=EventSeverity.INFO,
    ))


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


def _read(notice: DriverSubstitutionNotice, trip_id: uuid.UUID) -> SubstitutionNoticeRead:
    return SubstitutionNoticeRead(
        id=notice.id, request_id=notice.request_id, trip_id=trip_id, kind=SubstitutionNoticeKind(notice.kind),
        created_at=notice.created_at, read_at=notice.read_at,
    )


async def list_notices(
    db: AsyncSession, *, driver_id: uuid.UUID, unread_only: bool = True,
) -> list[SubstitutionNoticeRead]:
    """The caller's own notices, newest first, bounded. Never anyone else's."""
    query = (
        select(DriverSubstitutionNotice, DriverSubstitutionRequest.trip_id)
        .join(DriverSubstitutionRequest, DriverSubstitutionRequest.id == DriverSubstitutionNotice.request_id)
        .where(DriverSubstitutionNotice.recipient_driver_id == driver_id)
    )
    if unread_only:
        query = query.where(DriverSubstitutionNotice.read_at.is_(None))
    rows = await db.execute(
        query.order_by(DriverSubstitutionNotice.created_at.desc(), DriverSubstitutionNotice.id).limit(NOTICE_PAGE_LIMIT)
    )
    return [_read(notice, trip_id) for notice, trip_id in rows]


async def mark_notice_read(db: AsyncSession, *, notice_id: uuid.UUID, driver_id: uuid.UUID) -> SubstitutionNoticeRead:
    """Mark the caller's notice read. Repeats keep the first read_at; another driver's notice is 404."""
    row = (await db.execute(
        select(DriverSubstitutionNotice, DriverSubstitutionRequest.trip_id)
        .join(DriverSubstitutionRequest, DriverSubstitutionRequest.id == DriverSubstitutionNotice.request_id)
        .where(DriverSubstitutionNotice.id == notice_id, DriverSubstitutionNotice.recipient_driver_id == driver_id)
        .with_for_update(of=DriverSubstitutionNotice)
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("DriverSubstitutionNotice", str(notice_id))
    notice, trip_id = row
    if notice.read_at is None:
        notice.read_at = datetime.now(UTC)
        await db.flush()
    await db.refresh(notice)
    return _read(notice, trip_id)
