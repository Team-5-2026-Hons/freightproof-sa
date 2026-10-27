"""WI-21: a phase anchor is published after the OUTER commit, never on a savepoint release.

Model: test_evidence_anchor_recovery.py::test_nested_savepoint_release_does_not_publish_early,
which pins the same rules for the evidence-anchor dispatch. Releasing a begin_nested()
savepoint fires the session's after_commit hook, so a bare listener would hand the event id to
the worker before the request's transaction is durable (the worker opens its own session and
would find no row), and would still publish it when that transaction later rolls back.

The broker is a Mock (autouse stub in tests/conftest.py) and never reached.
"""

import asyncio
import uuid

from sqlalchemy import text

from app.db.models.enums import BlockchainReceiptType, PhaseStatus, PhaseType
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.anchor_dispatch import _BACKGROUND_ANCHOR_TASKS, _dispatch_anchor
from app.tasks.blockchain import anchor_phase_event_task

_PAYLOAD = {"payload_version": 2}


def _event() -> PhaseEvent:
    """A transient completed activation row: dispatch reads only its id and actor columns."""
    return PhaseEvent(id=uuid.uuid4(), trip_id=uuid.uuid4(), phase_type=PhaseType.ACTIVATION, status=PhaseStatus.COMPLETED)


def _register(db, event: PhaseEvent) -> None:
    _dispatch_anchor(db, event=event, canonical_payload=_PAYLOAD, receipt_type=BlockchainReceiptType.ACTIVATION)


async def _drain() -> None:
    while _BACKGROUND_ANCHOR_TASKS:
        await asyncio.gather(*tuple(_BACKGROUND_ANCHOR_TASKS))


async def test_a_savepoint_release_does_not_publish_but_the_outer_commit_does_once(db_session) -> None:
    event = _event()
    anchor_phase_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))
    _register(db_session, event)

    async with db_session.begin_nested():
        pass
    await _drain()
    anchor_phase_event_task.delay.assert_not_called()

    await db_session.commit()
    await _drain()
    await db_session.commit()
    await _drain()

    anchor_phase_event_task.delay.assert_called_once()
    assert anchor_phase_event_task.delay.call_args.args[0] == str(event.id)


async def test_an_outer_rollback_after_a_released_savepoint_publishes_nothing(db_session) -> None:
    anchor_phase_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))
    _register(db_session, _event())

    async with db_session.begin_nested():
        pass
    await db_session.rollback()
    await db_session.commit()
    await _drain()

    anchor_phase_event_task.delay.assert_not_called()


async def test_an_anchor_registered_in_a_rolled_back_savepoint_is_dropped_while_the_outer_commit_succeeds(
    db_session,
) -> None:
    """The row died with the savepoint, so publishing its id would announce nothing."""
    anchor_phase_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))

    savepoint = await db_session.begin_nested()
    _register(db_session, _event())
    await savepoint.rollback()
    await db_session.commit()
    await _drain()

    anchor_phase_event_task.delay.assert_not_called()
