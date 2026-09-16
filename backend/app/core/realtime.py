"""Org-wide realtime event bus for dispatcher live updates.

The dispatcher's SSE connection reacts to *thin* notifications: on a phase
completion or exception, this broadcasts a small ``TripEvent`` (ids + kind
only, no GPS/photos/parcel data — same POPIA surface as the read path) on the
trip's org channel, and the browser refetches the authorised endpoint it
already trusts.

Fan-out is Redis Pub/Sub (shared with Celery) since the write and the SSE
connection usually land on different API worker processes.

Publish-after-commit (D9): orchestration only ``flush()``s; ``get_db`` commits
after the endpoint returns. Callers ``enqueue_event`` onto a per-request
outbox, and a SQLAlchemy ``after_commit`` listener publishes once the data is
durable, so a race against an uncommitted transaction can't happen. A
rollback discards the outbox. The drain is a registered listener rather than
inline in ``get_db`` because layering forbids ``db/`` importing ``core/``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

import redis.asyncio as redis_async
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.enums import ExceptionSeverity

logger = logging.getLogger(__name__)

# One Pub/Sub channel per org; each screen filters the stream client-side.
CHANNEL_PREFIX = "org:"

# Key for the per-request outbox on Session.info (D9); AsyncSession.info
# proxies to the same dict the commit listener reads.
_OUTBOX_KEY = "realtime_outbox"


class RealtimeKind(str, Enum):
    """What changed. Deliberately coarse — the browser refetches for detail,
    so this only needs to say which refetch to run and whether to toast."""

    TRIP_CREATED = "trip_created"
    PHASE_COMPLETED = "phase_completed"
    EXCEPTION_RAISED = "exception_raised"
    EXCEPTION_REVIEWED = "exception_reviewed"
    TRIP_CLOSED = "trip_closed"


class EventSeverity(str, Enum):
    """How loudly the client should react — orthogonal to ``kind`` on purpose.

    Kept as its own enum rather than reusing db.models.enums.ExceptionSeverity
    since this rides the wire for non-exception events too (trip creation is
    INFO); values are kept equal so event_severity() stays a widening, not a
    translation table. Previously encoded into ``kind`` itself, which silently
    inverted loudness for driver-raised vs. system-detected exceptions.
    """

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


def event_severity(severity: ExceptionSeverity) -> EventSeverity:
    """Wire severity for an exception being written — always derived from the
    same value written to the TripException, never chosen separately."""
    return EventSeverity(severity.value)


class TripEvent(BaseModel):
    """A thin change notification. Carries no trip data by design (see module docstring)."""

    # Pins the bus to trip-scoped events today; a future resource is a
    # deliberate typed addition, not a silent one.
    resource: Literal["trip"] = "trip"
    id: UUID
    kind: RealtimeKind
    # Lifecycle events need say nothing (ordinary progress); only exceptions
    # have a case for interrupting whoever's on shift.
    severity: EventSeverity = EventSeverity.INFO
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))


def _channel(org_id: UUID) -> str:
    return f"{CHANNEL_PREFIX}{org_id}"


# ── Redis client ──────────────────────────────────────────────────────────────
# Lazily built so importing this module doesn't require a reachable Redis.
# decode_responses=True so payloads are str (JSON), not bytes.
_redis_client: redis_async.Redis | None = None


def _get_redis() -> redis_async.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_async.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def publish_event(org_id: UUID, event: TripEvent) -> None:
    """Broadcast one event on the org channel. Low-level — request handlers
    should use ``enqueue_event`` so the publish happens after commit (D9)."""
    await _get_redis().publish(_channel(org_id), event.model_dump_json())


async def subscribe(org_id: UUID) -> AsyncIterator[TripEvent]:
    """Yield events published to an org's channel until the caller stops
    iterating. One subscription per connected dispatcher's SSE endpoint."""
    pubsub = _get_redis().pubsub()
    await pubsub.subscribe(_channel(org_id))
    try:
        async for message in pubsub.listen():
            # listen() also emits subscribe/unsubscribe confirmations.
            if message.get("type") != "message":
                continue
            yield TripEvent.model_validate_json(message["data"])
    finally:
        await pubsub.unsubscribe(_channel(org_id))
        await pubsub.aclose()


# ── Per-request outbox + after-commit publish (D9) ─────────────────────────────


def enqueue_event(session: AsyncSession, org_id: UUID, event: TripEvent) -> None:
    """Queue an event to publish once the current transaction commits.

    The only entry point orchestration touches; nothing is published until
    ``after_commit`` fires.
    """
    session.info.setdefault(_OUTBOX_KEY, []).append((org_id, event))


# Strong refs to in-flight publish tasks — asyncio only holds a weak
# reference to scheduled tasks, so this prevents premature GC.
_pending_tasks: set[asyncio.Task[None]] = set()


async def _safe_publish(org_id: UUID, event: TripEvent) -> None:
    """Publish, swallowing any Redis failure. Fail-open: the commit already
    succeeded and the dispatcher's reconnect-refetch catches up regardless."""
    try:
        await publish_event(org_id, event)
    except Exception:
        logger.exception("Realtime publish failed for kind=%s (swallowed)", event.kind.value)


def _schedule_publish(org_id: UUID, event: TripEvent) -> None:
    """Schedule an async publish from the synchronous commit-event handler."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop (e.g. sync/offline commit) — drop rather than crash.
        logger.warning("No running event loop; dropping realtime event kind=%s", event.kind.value)
        return
    task = loop.create_task(_safe_publish(org_id, event))
    _pending_tasks.add(task)
    task.add_done_callback(_pending_tasks.discard)


def _drain_outbox(info: dict[str, Any], emit: Callable[[UUID, TripEvent], None]) -> None:
    """Pop the outbox off a session's info dict and hand each event to ``emit``.
    Pop, not read, so a re-committed session doesn't republish."""
    outbox: list[tuple[UUID, TripEvent]] | None = info.pop(_OUTBOX_KEY, None)
    if not outbox:
        return
    for org_id, event in outbox:
        emit(org_id, event)


def _on_commit(session: Session) -> None:
    """SQLAlchemy after_commit handler — publishes everything the request queued."""
    _drain_outbox(session.info, _schedule_publish)


def _on_rollback(session: Session) -> None:
    """SQLAlchemy after_rollback handler — a rolled-back request publishes nothing."""
    session.info.pop(_OUTBOX_KEY, None)


_hook_registered = False


def register_realtime_hook() -> None:
    """Attach the commit/rollback listeners once, at app startup. Idempotent
    so repeated calls (e.g. across test app instantiations) don't stack
    duplicate listeners. No-ops for sessions with no outbox (e.g. Alembic's)."""
    global _hook_registered
    if _hook_registered:
        return
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    event.listen(Session, "after_commit", _on_commit)
    event.listen(Session, "after_rollback", _on_rollback)
    _hook_registered = True
