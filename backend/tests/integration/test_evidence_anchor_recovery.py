"""FP-290 Task 2: dispatch after the OUTER commit, and recovery of anchor debt.

The dispatch tests drive the real SQLAlchemy after_commit machinery on the shared test
session; the broker is a Mock (see the autouse stub in tests/conftest.py) and never reached.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update

from app.core.exceptions import HederaServiceError
from app.db.models.enums import AnchorStatus, ExceptionType
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.orchestration.evidence_anchors import dispatch
from app.orchestration.evidence_anchors.dispatch import dispatch_evidence_anchor
from app.orchestration.evidence_anchors.recovery import recover_evidence_anchor
from app.orchestration.exceptions.creation import raise_exception
from app.tasks.evidence_anchors import anchor_event_task

from tests.integration._evidence_anchor_world import World, seed_world

_LONG_AGO = datetime(2020, 1, 1, tzinfo=UTC)


@pytest_asyncio.fixture
async def world(db_session) -> World:
    return await seed_world(db_session)


async def _event(db, world: World, *, status: AnchorStatus = AnchorStatus.PENDING,
                 age: timedelta = timedelta(hours=1)) -> uuid.UUID:
    report = await raise_exception(
        db, trip_id=world.trip_id, driver_id=world.driver_id,
        exception_type=ExceptionType.PANIC_BUTTON, description=f"Panic {uuid.uuid4()}",
        supporting_artifact_id=None,
    )
    event_id = report.anchor_events[0].event_id
    await db.execute(update(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id).values(
        anchor_status=status, updated_at=datetime.now(UTC) - age))
    db.expire_all()
    return event_id


async def _drain() -> None:
    while dispatch._BACKGROUND_EVIDENCE_TASKS:
        await asyncio.gather(*tuple(dispatch._BACKGROUND_EVIDENCE_TASKS))


async def _status(db, event_id: uuid.UUID) -> tuple[str, uuid.UUID | None]:
    event = (await db.execute(select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id))).scalar_one()
    return str(event.anchor_status.value if hasattr(event.anchor_status, "value") else event.anchor_status), event.receipt_id


# ── Dispatch ──────────────────────────────────────────────────────────────────

async def test_outer_commit_publishes_the_event_id_once(db_session):
    event_id = uuid.uuid4()
    anchor_event_task.delay.reset_mock()

    dispatch_evidence_anchor(db_session, event_id=event_id)
    anchor_event_task.delay.assert_not_called()
    await db_session.commit()
    await _drain()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_called_once_with(str(event_id))


async def test_rollback_publishes_nothing(db_session):
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))  # a request always has written something

    dispatch_evidence_anchor(db_session, event_id=uuid.uuid4())
    await db_session.rollback()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()


async def test_nested_savepoint_release_does_not_publish_early(db_session):
    """A begin_nested() release fires after_commit; the event must wait for the real one."""
    event_id = uuid.uuid4()
    anchor_event_task.delay.reset_mock()
    dispatch_evidence_anchor(db_session, event_id=event_id)

    async with db_session.begin_nested():
        pass
    await _drain()
    anchor_event_task.delay.assert_not_called()

    await db_session.commit()
    await _drain()
    anchor_event_task.delay.assert_called_once_with(str(event_id))


async def test_dispatch_inside_a_savepoint_waits_for_the_outer_commit(db_session):
    event_id = uuid.uuid4()
    anchor_event_task.delay.reset_mock()

    async with db_session.begin_nested():
        dispatch_evidence_anchor(db_session, event_id=event_id)
    await _drain()
    anchor_event_task.delay.assert_not_called()

    await db_session.commit()
    await _drain()
    anchor_event_task.delay.assert_called_once_with(str(event_id))


async def test_a_rolled_back_savepoint_does_not_cancel_the_dispatch(db_session):
    event_id = uuid.uuid4()
    anchor_event_task.delay.reset_mock()
    dispatch_evidence_anchor(db_session, event_id=event_id)

    savepoint = await db_session.begin_nested()
    await savepoint.rollback()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_called_once_with(str(event_id))


async def test_dispatch_registered_in_a_rolled_back_savepoint_is_discarded(db_session):
    """The event row died with the savepoint, so publishing its id would announce nothing."""
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))

    savepoint = await db_session.begin_nested()
    dispatch_evidence_anchor(db_session, event_id=uuid.uuid4())
    await savepoint.rollback()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()


async def test_dispatch_inside_a_failing_savepoint_block_is_discarded(db_session):
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))

    with pytest.raises(RuntimeError):
        async with db_session.begin_nested():
            dispatch_evidence_anchor(db_session, event_id=uuid.uuid4())
            raise RuntimeError("boom")
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()


async def test_only_the_rolled_back_savepoints_dispatches_are_discarded(db_session):
    kept, dropped, kept_after_release = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))
    dispatch_evidence_anchor(db_session, event_id=kept)  # registered before any savepoint

    savepoint = await db_session.begin_nested()
    dispatch_evidence_anchor(db_session, event_id=dropped)
    await savepoint.rollback()
    async with db_session.begin_nested():
        dispatch_evidence_anchor(db_session, event_id=kept_after_release)  # released, so it survives
    await db_session.commit()
    await _drain()

    assert sorted(c.args[0] for c in anchor_event_task.delay.call_args_list) == sorted(
        [str(kept), str(kept_after_release)])


async def test_inner_release_then_outer_rollback_discards_the_dispatch(db_session):
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))

    outer = await db_session.begin_nested()
    async with db_session.begin_nested():
        dispatch_evidence_anchor(db_session, event_id=uuid.uuid4())
    await outer.rollback()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()


async def test_inner_release_then_outer_release_still_publishes(db_session):
    event_id = uuid.uuid4()
    anchor_event_task.delay.reset_mock()
    await db_session.execute(text("select 1"))

    async with db_session.begin_nested():
        async with db_session.begin_nested():
            dispatch_evidence_anchor(db_session, event_id=event_id)
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_called_once_with(str(event_id))


async def test_unconfigured_publisher_logs_and_leaves_the_event_to_the_sweep(db_session, caplog):
    from app.orchestration.evidence_anchors.dispatch import configure_evidence_publisher
    anchor_event_task.delay.reset_mock()
    configure_evidence_publisher(None)

    dispatch_evidence_anchor(db_session, event_id=uuid.uuid4())
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()
    assert "No evidence publisher configured" in caplog.text


async def test_two_events_in_one_transaction_publish_once_each(db_session):
    first, second = uuid.uuid4(), uuid.uuid4()
    anchor_event_task.delay.reset_mock()

    dispatch_evidence_anchor(db_session, event_id=first)
    dispatch_evidence_anchor(db_session, event_id=second)
    await db_session.commit()
    await _drain()

    assert sorted(c.args[0] for c in anchor_event_task.delay.call_args_list) == sorted([str(first), str(second)])


async def test_broker_failure_falls_back_to_a_local_anchor(db_session, monkeypatch):
    event_id = uuid.uuid4()
    anchor_event_task.delay.side_effect = ConnectionError("broker down")
    local = AsyncMock(return_value=True)
    monkeypatch.setattr("app.tasks.evidence_anchors._anchor", local)

    dispatch_evidence_anchor(db_session, event_id=event_id)
    await db_session.commit()
    await _drain()

    local.assert_awaited_once_with(event_id=event_id)


# ── Recovery ──────────────────────────────────────────────────────────────────

async def test_never_dispatched_event_is_recovered_and_anchored(db_session, world):
    event_id = await _event(db_session, world)

    result = await recover_evidence_anchor(db_session, due_before=datetime.now(UTC))

    status, receipt_id = await _status(db_session, event_id)
    assert result is True
    assert status == "anchored" and receipt_id is not None


async def test_failed_event_with_exhausted_retries_is_still_eligible(db_session, world):
    event_id = await _event(db_session, world, status=AnchorStatus.FAILED)

    assert await recover_evidence_anchor(db_session, due_before=datetime.now(UTC)) is True

    assert (await _status(db_session, event_id))[0] == "anchored"


async def test_nothing_due_returns_none(db_session, world):
    await _event(db_session, world, age=timedelta(seconds=1))

    assert await recover_evidence_anchor(db_session, due_before=datetime.now(UTC) - timedelta(minutes=5)) is None


async def test_anchored_events_are_not_selected(db_session, world):
    await _event(db_session, world)
    assert await recover_evidence_anchor(db_session, due_before=datetime.now(UTC)) is True

    assert await recover_evidence_anchor(db_session, due_before=datetime.now(UTC)) is None


async def test_failed_attempt_rotates_updated_at_so_it_does_not_starve_newer_debts(
    db_session, world, monkeypatch,
):
    older = await _event(db_session, world, age=timedelta(hours=2))
    newer = await _event(db_session, world, age=timedelta(hours=1))
    real = AsyncMock(side_effect=HederaServiceError("hedera down"))
    monkeypatch.setattr("app.orchestration.evidence_anchors.execution.anchor_subject", real)
    cutoff = datetime.now(UTC)

    first = await recover_evidence_anchor(db_session, due_before=cutoff)
    second = await recover_evidence_anchor(db_session, due_before=cutoff)

    # The oldest debt goes first, and failing moves it behind the newer one rather than
    # being retried forever ahead of it.
    attempted = [call.kwargs["subject_id"] for call in real.await_args_list]
    assert (first, second) == (False, False)
    assert attempted == [older, newer]
    assert (await _status(db_session, older))[0] == "failed"
    assert (await _status(db_session, newer))[0] == "failed"


# ── Wired into report creation ────────────────────────────────────────────────

async def _critical_report(db, world: World):
    return await raise_exception(
        db, trip_id=world.trip_id, driver_id=world.driver_id,
        exception_type=ExceptionType.PANIC_BUTTON, description="Panic.", supporting_artifact_id=None,
    )


async def test_critical_report_dispatches_its_event_only_after_commit(db_session, world):
    anchor_event_task.delay.reset_mock()

    report = await _critical_report(db_session, world)
    await _drain()
    anchor_event_task.delay.assert_not_called()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_called_once_with(str(report.anchor_events[0].event_id))


async def test_rolled_back_critical_report_dispatches_nothing(db_session, world):
    anchor_event_task.delay.reset_mock()

    await _critical_report(db_session, world)
    await db_session.rollback()
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()


async def test_warning_report_dispatches_nothing(db_session, world):
    anchor_event_task.delay.reset_mock()

    await raise_exception(
        db_session, trip_id=world.trip_id, driver_id=world.driver_id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="Dent.", supporting_artifact_id=None,
    )
    await db_session.commit()
    await _drain()

    anchor_event_task.delay.assert_not_called()
