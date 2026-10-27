"""C0R — realtime events follow the OUTERMOST transaction, through real PostgreSQL.

SQLAlchemy fires ``after_commit`` when a SAVEPOINT is released and ``after_rollback`` when
one is rolled back. The original hook treated both as the end of the request, so an event
queued before ``begin_nested()`` was published while the outer transaction could still roll
back, and a failed nested scope wiped events the parent had legitimately queued.

These tests use real committed/rolled-back sessions on the test database (no data is
written, so nothing needs cleaning up) and replace only ``publish_event``, the Redis call.
``db_session`` is deliberately not used: its connection-level transaction would turn every
commit into a savepoint release and hide exactly the boundary under test.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import realtime
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, register_realtime_hook


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[TripEvent]:
    """Events handed to the (faked) Redis publisher, in call order."""
    sent: list[TripEvent] = []

    async def record(_org_id: uuid.UUID, event: TripEvent) -> None:
        sent.append(event)

    monkeypatch.setattr(realtime, "publish_event", record)
    register_realtime_hook()
    return sent


async def _settle() -> None:
    """Let publish tasks scheduled by the commit hook run to completion."""
    loop = asyncio.get_running_loop()
    while own := [task for task in realtime._pending_tasks if task.get_loop() is loop]:
        await asyncio.wait(own, timeout=5)
    await asyncio.sleep(0)


def _queue(session: AsyncSession) -> TripEvent:
    event = TripEvent(id=uuid.uuid4(), kind=RealtimeKind.PHASE_COMPLETED)
    enqueue_event(session, uuid.uuid4(), event)
    return event


async def _open(test_engine) -> AsyncSession:
    session = AsyncSession(test_engine, expire_on_commit=False)
    await session.execute(text("SELECT 1"))
    return session


async def test_savepoint_release_never_publishes_before_outer_commit(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        before = _queue(session)
        async with session.begin_nested():
            inside = _queue(session)
        await _settle()

        released_but_uncommitted = list(published)

        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert released_but_uncommitted == []
    assert published == [before, inside]


async def test_outer_rollback_after_savepoint_release_publishes_nothing(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        _queue(session)
        async with session.begin_nested():
            _queue(session)
        await session.rollback()
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == []


async def test_nested_rollback_preserves_only_parent_outbox(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        kept = _queue(session)
        savepoint = await session.begin_nested()
        _queue(session)
        await savepoint.rollback()
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == [kept]


async def test_failed_inner_scope_after_released_scope_retains_only_committed_events(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        parent = _queue(session)
        async with session.begin_nested():
            released = _queue(session)
        with pytest.raises(RuntimeError):
            async with session.begin_nested():
                _queue(session)
                raise RuntimeError("scope fails")
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == [parent, released]


async def test_ordinary_commit_publishes_exactly_once(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        only = _queue(session)
        await session.commit()
        await session.execute(text("SELECT 1"))
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == [only]


async def test_repeated_registration_does_not_double_publish(test_engine, published) -> None:
    register_realtime_hook()
    register_realtime_hook()
    session = await _open(test_engine)
    try:
        only = _queue(session)
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == [only]


async def test_outer_rollback_with_open_savepoint_publishes_nothing(test_engine, published) -> None:
    session = await _open(test_engine)
    try:
        _queue(session)
        await session.begin_nested()
        _queue(session)
        await session.rollback()
        await session.execute(text("SELECT 1"))
        await session.commit()
        await _settle()
    finally:
        await session.close()

    assert published == []
