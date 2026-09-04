"""Org-wide realtime event bus for dispatcher live updates.

The dispatcher portal keeps one Server-Sent Events connection open (see the SSE
endpoint added in Stage 2) and reacts to *thin* notifications published here: when
a driver completes a phase or raises an exception, this module broadcasts a small
``TripEvent`` on the trip's organisation channel, and the dispatcher's browser
refetches the authorised ``GET /trips/{id}`` it already trusts. No trip data — no
GPS, photos, or parcel details — ever crosses this channel; only ids and a kind.
That keeps the POPIA surface identical to the existing read path.

Fan-out is Redis Pub/Sub (the same Redis that backs Celery), because in production
the API runs as several workers: the worker that handled the driver's write and the
worker holding the dispatcher's SSE connection are usually different processes, and
only a shared broker can carry a message between them.

Publish-after-commit (D9). The orchestration services only ``flush()``; the request's
transaction is committed by ``get_db`` *after* the endpoint returns. Publishing from
inside a service would race the dispatcher's refetch against an uncommitted
transaction, so callers instead ``enqueue_event`` onto a per-request outbox and a
SQLAlchemy ``after_commit`` listener does the actual publish once the data is durable.
A rollback discards the outbox and publishes nothing. The drain is a registered event
listener rather than a line in ``get_db`` because the layering law forbids ``db/``
importing ``core/`` — the dependency only ever points core → db.
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

# Redis Pub/Sub channel per organisation. One channel carries every change a
# dispatcher in that org is entitled to see; each screen filters the stream client-side.
CHANNEL_PREFIX = "org:"

# Key under which the per-request outbox lives on Session.info (D9). AsyncSession.info
# proxies to its underlying sync Session.info — the same dict the commit listener reads.
_OUTBOX_KEY = "realtime_outbox"


class RealtimeKind(str, Enum):
    """What changed. Deliberately coarse — the browser refetches for the detail, so
    the kind only needs to say *which* refetch to run and whether to raise a toast."""

    TRIP_CREATED = "trip_created"
    PHASE_COMPLETED = "phase_completed"
    EXCEPTION_RAISED = "exception_raised"
    TRIP_CLOSED = "trip_closed"


class EventSeverity(str, Enum):
    """How loudly the client should react. Orthogonal to ``kind`` on purpose.

    An earlier revision of this module encoded loudness INTO the kind (a
    ``tamper_detected`` member sitting beside ``exception_raised``). That conflated
    two independent questions — *what changed* and *how much it matters* — and the
    conflation produced a real inversion: the six system-detected exception sites
    routed CRITICAL rows to the loud kind, while exception_service published every
    driver-raised exception as the quiet one. A panic button pressed during a
    hijacking was therefore quieter on the dispatcher's screen than an automated
    parcel-count check.

    Splitting the axes fixes that at the root rather than at one more call site, and
    keeps the kind enum free to grow (the step-event ledger adds its own kinds) without
    needing a loud and a quiet variant of each.

    Deliberately its own enum rather than reusing db.models.enums.ExceptionSeverity:
    this rides the wire and applies to events that are not exceptions at all — a trip
    being created is INFO — so the two are free to diverge. The values are kept equal
    so the mapping below stays a widening, not a translation table.
    """

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


def event_severity(severity: ExceptionSeverity) -> EventSeverity:
    """Wire severity for an exception being written. Derived, never chosen per site.

    Every caller passes the same value it hands the TripException, so a severity
    edited later drags its loudness with it and the two cannot drift apart. One site
    computes its severity at runtime (seal continuity is WARNING when a dispatcher
    override explains the missing seal, CRITICAL otherwise), which is why a constant
    per call site was never sufficient.
    """
    return EventSeverity(severity.value)


class TripEvent(BaseModel):
    """A thin change notification. Carries no trip data by design (see module docstring)."""

    # Literal, not a bare str: today the bus only carries trip-scoped events, and pinning
    # the value makes a future non-trip resource a deliberate, typed addition rather than
    # a silent one.
    resource: Literal["trip"] = "trip"
    id: UUID
    kind: RealtimeKind
    # Defaults to INFO so the lifecycle emits (created / phase completed / closed) need
    # say nothing: they are ordinary progress, and only an exception has a case for
    # interrupting whoever is on shift.
    severity: EventSeverity = EventSeverity.INFO
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))


def _channel(org_id: UUID) -> str:
    return f"{CHANNEL_PREFIX}{org_id}"


# ── Redis client ──────────────────────────────────────────────────────────────
# Lazily created and cached: the URL comes from settings, and building the client at
# import time would couple module import to a reachable Redis. decode_responses=True so
# published payloads and received messages are str (JSON), not bytes.
_redis_client: redis_async.Redis | None = None


def _get_redis() -> redis_async.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_async.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def publish_event(org_id: UUID, event: TripEvent) -> None:
    """Broadcast one event on the org channel. Low-level primitive — callers in request
    handlers should use ``enqueue_event`` so the publish happens after commit (D9)."""
    await _get_redis().publish(_channel(org_id), event.model_dump_json())


async def subscribe(org_id: UUID) -> AsyncIterator[TripEvent]:
    """Yield events published to an org's channel until the caller stops iterating.

    Used by the SSE endpoint (Stage 2), one subscription per connected dispatcher.
    Cleans up the Redis subscription on exit so a disconnecting browser leaves nothing
    behind.
    """
    pubsub = _get_redis().pubsub()
    await pubsub.subscribe(_channel(org_id))
    try:
        async for message in pubsub.listen():
            # listen() also emits the subscribe/unsubscribe confirmations — only real
            # published payloads carry type "message".
            if message.get("type") != "message":
                continue
            yield TripEvent.model_validate_json(message["data"])
    finally:
        await pubsub.unsubscribe(_channel(org_id))
        await pubsub.aclose()


# ── Per-request outbox + after-commit publish (D9) ─────────────────────────────


def enqueue_event(session: AsyncSession, org_id: UUID, event: TripEvent) -> None:
    """Queue an event to publish once the current transaction commits.

    The only entry point orchestration touches. Appends to the request's outbox and
    returns immediately; nothing is published until ``after_commit`` fires.
    """
    session.info.setdefault(_OUTBOX_KEY, []).append((org_id, event))


# Strong refs to in-flight publish tasks so the event loop does not garbage-collect a
# task before it runs (asyncio only holds a weak reference to scheduled tasks).
_pending_tasks: set[asyncio.Task[None]] = set()


async def _safe_publish(org_id: UUID, event: TripEvent) -> None:
    """Publish, swallowing any Redis failure. Fail-open: the commit already succeeded and
    is the source of truth, and the dispatcher's reconnect-refetch catches up regardless —
    a broker hiccup must never surface as an error on the driver's completed write."""
    try:
        await publish_event(org_id, event)
    except Exception:
        logger.exception("Realtime publish failed for kind=%s (swallowed)", event.kind.value)


def _schedule_publish(org_id: UUID, event: TripEvent) -> None:
    """Schedule an async publish from the synchronous commit-event handler. The commit is
    driven by the running asyncio loop, so a task scheduled here runs right after the
    request's greenlet yields back."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop (e.g. a commit from a sync/offline context). Nothing can carry
        # the async publish here; drop it rather than crash the commit.
        logger.warning("No running event loop; dropping realtime event kind=%s", event.kind.value)
        return
    task = loop.create_task(_safe_publish(org_id, event))
    _pending_tasks.add(task)
    task.add_done_callback(_pending_tasks.discard)


def _drain_outbox(info: dict[str, Any], emit: Callable[[UUID, TripEvent], None]) -> None:
    """Pop the outbox off a session's info dict and hand each queued event to ``emit``.
    Pop, not read: an emptied outbox must not be re-published if the same session commits
    again later in its life."""
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
    """Attach the commit/rollback listeners once, at app startup. Idempotent so repeated
    calls (e.g. across test app instantiations) do not stack duplicate listeners.

    Listeners are attached to the ORM ``Session`` class and no-op unless a session carries
    an outbox, so sessions that never call ``enqueue_event`` (including Alembic's) are
    unaffected."""
    global _hook_registered
    if _hook_registered:
        return
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    event.listen(Session, "after_commit", _on_commit)
    event.listen(Session, "after_rollback", _on_rollback)
    _hook_registered = True
