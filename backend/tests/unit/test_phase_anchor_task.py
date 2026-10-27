"""WI-27 item 6: the phase anchor Celery task's success and retry paths.

test_blockchain_task_registration.py already pins registration and the "receipt still owed"
retry. This adds what it leaves out: the success path, the infrastructure-error retry, and
`_anchor`'s commit-and-dispose contract. Characterisation for WI-21/WI-22, which change how
the task gets dispatched but must not change what it does once it runs.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.db.models.enums import BlockchainReceiptType
from app.tasks import blockchain
from app.tasks.blockchain import anchor_phase_event_task


class _RetryRequested(Exception):
    pass


def test_task_returns_true_and_does_not_retry_when_the_receipt_is_written(monkeypatch):
    event_id = uuid.uuid4()
    payload = {"payload_version": 2}
    anchor = AsyncMock(return_value=True)
    monkeypatch.setattr(blockchain, "_anchor", anchor)

    with patch.object(anchor_phase_event_task, "retry") as retry:
        result = anchor_phase_event_task.run(str(event_id), payload, "pickup")

    assert result is True
    retry.assert_not_called()
    anchor.assert_awaited_once_with(
        phase_event_id=event_id, canonical_payload=payload, receipt_type=BlockchainReceiptType("pickup"),
    )


def test_task_retries_with_the_original_error_on_an_infrastructure_failure(monkeypatch):
    boom = ConnectionError("db down")
    monkeypatch.setattr(blockchain, "_anchor", AsyncMock(side_effect=boom))

    with patch.object(anchor_phase_event_task, "retry", side_effect=_RetryRequested) as retry:
        with pytest.raises(_RetryRequested):
            anchor_phase_event_task.run(str(uuid.uuid4()), {"payload_version": 2}, "pickup")

    retry.assert_called_once()
    assert retry.call_args.kwargs["exc"] is boom


def _fake_engine_world(monkeypatch):
    engine = MagicMock()
    engine.dispose = AsyncMock()
    session = MagicMock()
    session.commit = AsyncMock()
    session_cm = MagicMock()
    session_cm.__aenter__ = AsyncMock(return_value=session)
    session_cm.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(blockchain, "create_async_engine", lambda *_a, **_k: engine)
    monkeypatch.setattr(blockchain, "async_sessionmaker", lambda **_k: lambda: session_cm)
    return engine, session


async def test_anchor_commits_the_outcome_and_disposes_its_engine(monkeypatch):
    engine, session = _fake_engine_world(monkeypatch)
    execute = AsyncMock(return_value=False)
    monkeypatch.setattr("app.orchestration.phases.anchor_execution.anchor_phase_event", execute)

    result = await blockchain._anchor(
        phase_event_id=uuid.uuid4(), canonical_payload={"payload_version": 2},
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    assert result is False
    session.commit.assert_awaited_once()
    engine.dispose.assert_awaited_once()


async def test_anchor_disposes_its_engine_without_committing_when_the_attempt_raises(monkeypatch):
    engine, session = _fake_engine_world(monkeypatch)
    monkeypatch.setattr(
        "app.orchestration.phases.anchor_execution.anchor_phase_event", AsyncMock(side_effect=ConnectionError),
    )

    with pytest.raises(ConnectionError):
        await blockchain._anchor(
            phase_event_id=uuid.uuid4(), canonical_payload={"payload_version": 2},
            receipt_type=BlockchainReceiptType.PICKUP,
        )

    session.commit.assert_not_awaited()
    engine.dispose.assert_awaited_once()
