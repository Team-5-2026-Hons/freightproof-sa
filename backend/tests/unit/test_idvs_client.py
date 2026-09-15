"""MockIdvsClient behaviour. No network, no Redis — a dict-backed store is injected."""

from typing import Any, Optional

import pytest

from app.integrations.idvs import (
    IdvsDecisionStatus,
    MockIdvsClient,
    _parse_decision,
)


class FakeStore:
    """Dict-backed MockStateStore, so these tests need no Redis."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> Optional[dict[str, Any]]:
        return self.data.get(key)

    async def get_many_json(self, keys: list[str]) -> list[Optional[dict[str, Any]]]:
        return [self.data.get(k) for k in keys]

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


async def test_create_session_returns_a_distinct_session_id_and_url():
    client = MockIdvsClient(store=FakeStore())

    first = await client.create_session(reference="handover-1")
    second = await client.create_session(reference="handover-2")

    assert first.session_id != second.session_id
    assert first.session_id in first.session_url


async def test_decision_defaults_to_approved_for_an_unstaged_session():
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1")

    decision = await client.get_decision(session.session_id)

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.session_id == session.session_id


async def test_staged_decline_is_returned_for_that_session_only():
    store = FakeStore()
    client = MockIdvsClient(store=store)
    declined = await client.create_session(reference="handover-1")
    approved = await client.create_session(reference="handover-2")

    await client.stage_decision(
        declined.session_id, status=IdvsDecisionStatus.DECLINED,
    )

    assert (await client.get_decision(declined.session_id)).status is IdvsDecisionStatus.DECLINED
    assert (await client.get_decision(approved.session_id)).status is IdvsDecisionStatus.APPROVED


async def test_staged_extracted_identity_is_returned():
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1")

    await client.stage_decision(
        session.session_id,
        status=IdvsDecisionStatus.APPROVED,
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    )
    decision = await client.get_decision(session.session_id)

    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


async def test_staging_is_refused_when_mock_mode_is_off(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.integrations.idvs import IdvsUnsupportedError

    monkeypatch.setattr(settings, "IDVS_USE_MOCK", False)
    client = MockIdvsClient(store=FakeStore())

    with pytest.raises(IdvsUnsupportedError):
        await client.stage_decision("any-session", status=IdvsDecisionStatus.DECLINED)



def test_parse_decision_reads_status_and_extracted_fields():
    payload = {
        "session_id": "abc123",
        "status": "Approved",
        "decision": {"surname": "Nkosi", "document_number": "9202204720082"},
    }

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


def test_parse_decision_tolerates_a_missing_decision_block():
    decision = _parse_decision({"status": "Abandoned"}, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.ABANDONED
    assert decision.extracted_surname is None
    assert decision.extracted_id_number is None
    assert decision.session_id == "abc123"


def test_parse_decision_maps_an_unknown_status_to_in_progress():
    decision = _parse_decision({"status": "Teleported"}, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.IN_PROGRESS
    assert not decision.status.is_terminal
