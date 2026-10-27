"""Request-side anchoring: queue an evidence event's anchor for the worker once the request's
OUTER transaction has committed, with an in-process fallback if the broker is unreachable.

Copied from phases/anchor_dispatch.py rather than shared, so the phase path stays untouched.
Two deliberate differences: how "committed" is decided (see dispatch_evidence_anchor), and
that the broker and the fallback anchor are INJECTED (configure_evidence_publisher) instead
of imported from tasks/, so this module needs no upward import and no import-linter waiver.
app/main.py wires them at startup; the worker has them by importing tasks.evidence_anchors.
"""

import asyncio
import logging
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from sqlalchemy import event as event_module
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

logger = logging.getLogger(__name__)

_BACKGROUND_EVIDENCE_TASKS: set[asyncio.Task[bool]] = set()


@dataclass(frozen=True)
class EvidencePublisher:
    """What dispatch needs from the task layer. `publish` is the blocking broker call
    (event id as a string); `anchor_locally` is the last-resort in-process anchor."""
    publish: Callable[[str], object]
    anchor_locally: Callable[[uuid.UUID], Coroutine[Any, Any, bool]]


_publisher: EvidencePublisher | None = None


def configure_evidence_publisher(publisher: EvidencePublisher | None) -> None:
    global _publisher
    _publisher = publisher


def dispatch_evidence_anchor(db: AsyncSession, *, event_id: uuid.UUID) -> None:
    """Queue this event's anchor for the worker, AFTER the outer transaction commits.

    The commit-tracking itself is run_after_outer_commit, shared with the FP-83 custody
    anchors (orchestration/substitutions/anchors.py) so its savepoint handling exists once.

    The worker opens its own session, so a task sent mid-transaction could look for an event
    row that is not committed yet. A rollback publishes nothing; the committed-but-never-sent
    case (crash, broker loss) is what the recovery sweep exists for.

    Savepoint traps: releasing a begin_nested() savepoint fires the session's after_commit
    hook (the realtime outbox is bitten by this too). Inside that hook the session reports
    in_nested_transaction() == True for a release and False for the real commit, so a release
    is ignored. And the event row lives in the transaction that was current at registration:
    if THAT savepoint rolls back the row is gone, so the dispatch is dropped; if it is
    released, the row now belongs to the parent and the dispatch follows it. Everything is
    spent when the root transaction ends, committed or not.
    """
    run_after_outer_commit(db, lambda: _retain(asyncio.get_running_loop().create_task(_publish(event_id)), event_id))


def run_after_outer_commit(db: AsyncSession, start: Callable[[], None]) -> None:
    """Call `start` once, when the root transaction that owns the caller's new row commits.

    Ignores savepoint releases, follows a released savepoint's rows into its parent, and drops
    the call if the owning transaction rolls back (see dispatch_evidence_anchor). `start` runs
    inside SQLAlchemy's after_commit hook, so it must only schedule work, never touch the session.
    """
    sync_session = db.sync_session
    owner: SessionTransaction | None = sync_session.get_nested_transaction() or sync_session.get_transaction()
    spent = False

    owner_released = False

    def _on_commit(session: Session) -> None:
        nonlocal spent, owner_released
        if session.in_nested_transaction():
            if session.get_nested_transaction() is owner:
                owner_released = True
            return
        if spent:
            return
        spent = True
        start()

    def _on_transaction_end(_session: Session, transaction: SessionTransaction) -> None:
        nonlocal owner, spent, owner_released
        if transaction is owner:
            if owner_released:
                owner, owner_released = transaction.parent, False
            else:
                spent = True
        if transaction.parent is None:
            spent = True

    event_module.listen(sync_session, "after_commit", _on_commit)
    event_module.listen(sync_session, "after_transaction_end", _on_transaction_end)


async def _publish(event_id: uuid.UUID) -> bool:
    publisher = _publisher
    if publisher is None:
        logger.error(
            "No evidence publisher configured; evidence_event_id=%s will be anchored by the recovery sweep",
            event_id,
        )
        return False
    try:
        await asyncio.to_thread(publisher.publish, str(event_id))
    except Exception:  # noqa: BLE001 — any broker failure, not just one library's
        logger.exception(
            "Could not queue the anchor for evidence_event_id=%s — scheduling local fallback", event_id,
        )
        _retain(asyncio.get_running_loop().create_task(publisher.anchor_locally(event_id)), event_id)
    return True


def _retain(task: asyncio.Task[bool], event_id: uuid.UUID) -> None:
    """Observe best-effort dispatch/fallback work; the event row backs crash recovery."""
    _BACKGROUND_EVIDENCE_TASKS.add(task)

    def _observe(completed: asyncio.Task[bool]) -> None:
        _BACKGROUND_EVIDENCE_TASKS.discard(completed)
        try:
            completed.result()
        except asyncio.CancelledError:
            logger.warning("Background anchor work cancelled for evidence_event_id=%s; recovery will retry", event_id)
        except Exception:  # noqa: BLE001 — task boundary must observe every failure
            logger.exception("Background anchor work failed for evidence_event_id=%s; recovery will retry", event_id)

    task.add_done_callback(_observe)
