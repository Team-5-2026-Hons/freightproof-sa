"""Task registration, constants and failure policy for the evidence-anchor Celery tasks."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.tasks import blockchain, celery
from app.tasks import evidence_anchors as tasks


def test_anchor_task_is_registered_with_the_phase_retry_policy():
    task = celery.tasks["tasks.evidence_anchors.anchor_event"]

    assert task.acks_late is True
    assert task.reject_on_worker_lost is True
    assert task.max_retries == 3
    assert task.default_retry_delay == 30


def test_recovery_task_is_registered_and_beat_scheduled_like_the_phase_sweep():
    task = celery.tasks["tasks.evidence_anchors.recover_events"]
    schedule = celery.conf.beat_schedule["recover-evidence-anchors"]

    assert schedule["task"] == task.name
    assert schedule["schedule"] == blockchain.PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS == 60
    assert schedule["options"] == {"expires": 60}
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True


def test_sweep_constants_are_the_phase_constants():
    assert tasks.RECOVERY_DELAY_SECONDS == blockchain._RECOVERY_DELAY_SECONDS == 300
    assert tasks.RECOVERY_BATCH_SIZE == blockchain._RECOVERY_BATCH_SIZE == 20


def test_phase_task_path_is_untouched():
    assert "tasks.blockchain.anchor_phase_event" in celery.tasks
    assert "recover-phase-anchors" in celery.conf.beat_schedule


class _Retry(Exception):
    pass


def test_task_retries_when_the_receipt_is_still_owed(monkeypatch):
    monkeypatch.setattr(tasks, "_anchor", AsyncMock(return_value=False))

    with patch.object(tasks.anchor_event_task, "retry", side_effect=_Retry) as retry:
        with pytest.raises(_Retry):
            tasks.anchor_event_task.run(str(uuid.uuid4()))

    assert isinstance(retry.call_args.kwargs["exc"], RuntimeError)


def test_task_retries_on_infrastructure_error(monkeypatch):
    boom = ConnectionError("db down")
    monkeypatch.setattr(tasks, "_anchor", AsyncMock(side_effect=boom))

    with patch.object(tasks.anchor_event_task, "retry", side_effect=_Retry) as retry:
        with pytest.raises(_Retry):
            tasks.anchor_event_task.run(str(uuid.uuid4()))

    assert retry.call_args.kwargs["exc"] is boom


def test_task_returns_true_and_does_not_retry_on_success(monkeypatch):
    event_id = uuid.uuid4()
    anchor = AsyncMock(return_value=True)
    monkeypatch.setattr(tasks, "_anchor", anchor)

    with patch.object(tasks.anchor_event_task, "retry") as retry:
        assert tasks.anchor_event_task.run(str(event_id)) is True

    retry.assert_not_called()
    anchor.assert_awaited_once_with(event_id=event_id)


def _fake_engine_world(monkeypatch):
    engine = MagicMock()
    engine.dispose = AsyncMock()
    session = MagicMock()
    session.commit = AsyncMock()
    session_cm = MagicMock()
    session_cm.__aenter__ = AsyncMock(return_value=session)
    session_cm.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(tasks, "create_async_engine", lambda *_a, **_k: engine)
    monkeypatch.setattr(tasks, "async_sessionmaker", lambda **_k: lambda: session_cm)
    return engine, session


async def test_anchor_commits_the_outcome_and_disposes_its_engine(monkeypatch):
    engine, session = _fake_engine_world(monkeypatch)
    monkeypatch.setattr(tasks, "anchor_evidence_event", AsyncMock(return_value=False))

    result = await tasks._anchor(event_id=uuid.uuid4())

    # A failed attempt is a state worth keeping (anchor_status=failed), so it is committed.
    assert result is False
    session.commit.assert_awaited_once()
    engine.dispose.assert_awaited_once()


async def test_anchor_disposes_its_engine_when_the_attempt_raises(monkeypatch):
    engine, session = _fake_engine_world(monkeypatch)
    monkeypatch.setattr(tasks, "anchor_evidence_event", AsyncMock(side_effect=ConnectionError))

    with pytest.raises(ConnectionError):
        await tasks._anchor(event_id=uuid.uuid4())

    session.commit.assert_not_awaited()
    engine.dispose.assert_awaited_once()
