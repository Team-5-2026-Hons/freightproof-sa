import uuid
from unittest.mock import patch

import pytest

from app.tasks import celery
from app.tasks.blockchain import anchor_phase_event_task


def test_blockchain_anchor_task_is_registered_with_worker_app():
    task = celery.tasks["tasks.blockchain.anchor_phase_event"]

    assert task.acks_late is True
    assert task.reject_on_worker_lost is True
    assert task.max_retries == 3


def test_recovery_is_registered_and_scheduled():
    task = celery.tasks["tasks.blockchain.recover_phase_anchors"]
    schedule = celery.conf.beat_schedule["recover-phase-anchors"]
    assert schedule["task"] == task.name
    assert schedule["schedule"] == 60
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True


def test_blockchain_anchor_task_retries_when_receipt_remains_owed(monkeypatch):
    class RetryRequested(Exception):
        pass

    async def _not_anchored(**_kwargs):
        return False

    monkeypatch.setattr("app.tasks.blockchain._anchor", _not_anchored)
    with patch.object(anchor_phase_event_task, "retry", side_effect=RetryRequested) as retry:
        with pytest.raises(RetryRequested):
            anchor_phase_event_task.run(
                str(uuid.uuid4()), {"payload_version": 2}, "pickup",
            )

    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], RuntimeError)
