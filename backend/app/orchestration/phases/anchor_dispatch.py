"""Request-side anchoring: queue the Hedera submit on the Celery worker after the request's
transaction commits, with an in-process fallback if the broker is unreachable. Imports
tasks.blockchain lazily, as tasks.blockchain re-enters phases.anchor_execution.
"""

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import event as event_module
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.enums import AnchorStatus, BlockchainReceiptType
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.anchor_execution import receipt_type_for

logger = logging.getLogger(__name__)


# asyncio keeps only weak references to scheduled tasks. Retain dispatches and
# fallback anchors until their completion callback has observed the result.
_BACKGROUND_ANCHOR_TASKS: set[asyncio.Task[bool]] = set()


def _dispatch_anchor(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Queue this event's anchor for the worker, AFTER this request's transaction commits.

    Anchoring moved off the request path because a Hedera submit takes ~4-6s and the
    driver was holding a swipe control for all of it. The phase is evidence the moment it
    is written; the receipt is a separate fact that lands shortly after, which is exactly
    what anchor_status (PENDING -> ANCHORED/FAILED) and the driver app's "anchoring in
    progress" state already describe.

    Two things make this safe rather than merely faster:

    * It fires on after_commit, never before. The worker opens its OWN session, so a task
      dispatched mid-transaction could look for a phase_event row that isn't committed yet
      and find nothing.
    * If the broker cannot be reached, it schedules an immediate in-process fallback.
      This preserves the anchor attempt without turning the API event loop into a
      blocking Hedera worker.
    """
    # Imported at call time: tasks/blockchain.py imports this module back, and Celery's
    # own import is heavy enough to be worth keeping out of the request path's cold start.
    from app.tasks.blockchain import anchor_phase_event_task

    event_id = event.id
    payload = dict(canonical_payload)
    event.anchor_status = AnchorStatus.PENDING

    async def _publish() -> bool:
        try:
            await asyncio.to_thread(
                anchor_phase_event_task.delay, str(event_id), payload, receipt_type.value,
            )
        except Exception:  # noqa: BLE001 — any broker failure, not just one library's
            logger.exception(
                "Could not queue the anchor for phase_event_id=%s — scheduling local fallback",
                event_id,
            )
            _schedule_anchor_after_dispatch_failure(
                phase_event_id=event_id, canonical_payload=payload, receipt_type=receipt_type,
            )
        return True

    def _send(_session: Any) -> None:
        _retain_anchor_task(asyncio.get_running_loop().create_task(_publish()), event_id)

    # sync_session: SQLAlchemy's event system is synchronous, and after_commit is the
    # only hook that fires once this request's write is actually durable.
    event_module.listens_for(db.sync_session, "after_commit", once=True)(_send)


def _schedule_anchor_after_dispatch_failure(
    *, phase_event_id: uuid.UUID, canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
) -> None:
    """Start a last-resort in-process anchor when the broker is unreachable.

    The coroutine uses its own session because the request transaction has committed.
    Scheduling it on the existing server loop avoids both illegal nested asyncio.run()
    calls and blocking every request while Hedera responds.
    """
    from app.tasks.blockchain import _anchor

    anchor = _anchor(
        phase_event_id=phase_event_id,
        canonical_payload=canonical_payload,
        receipt_type=receipt_type,
    )
    task = asyncio.get_running_loop().create_task(anchor)
    _retain_anchor_task(task, phase_event_id)


def _retain_anchor_task(task: asyncio.Task[bool], phase_event_id: uuid.UUID) -> None:
    """Observe best-effort dispatch/fallback work; the ledger backs crash recovery."""
    _BACKGROUND_ANCHOR_TASKS.add(task)

    def _observe_result(completed: asyncio.Task[bool]) -> None:
        _BACKGROUND_ANCHOR_TASKS.discard(completed)
        try:
            completed.result()
        except asyncio.CancelledError:
            logger.warning(
                "Background anchor work cancelled for phase_event_id=%s; recovery will retry",
                phase_event_id,
            )
        except Exception:  # noqa: BLE001 — task boundary must observe every failure
            logger.exception(
                "Background anchor work failed for phase_event_id=%s; recovery will retry",
                phase_event_id,
            )

    task.add_done_callback(_observe_result)


def _anchor_phase(db: AsyncSession, *, event: PhaseEvent, canonical_payload: dict[str, Any]) -> None:
    """Commit this row to its payload hash and queue the anchor.

    The hash is written on the row in the same transaction as the evidence, so the
    recovery sweep and verification can rebuild the payload later and prove it
    unchanged. Call only once the row's status is final for this request (COMPLETED,
    EXCEPTION or OVERRIDDEN), because receipt_type_for reads it.
    """
    event.event_hash = compute_payload_hash(canonical_payload)
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload, receipt_type=receipt_type_for(event),
    )
