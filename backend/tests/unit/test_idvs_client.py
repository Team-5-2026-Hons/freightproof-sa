"""MockIdvsClient behaviour, and the vendor-shape parsing DiditIdvsClient depends on.

The DiditIdvsClient tests below run against httpx.MockTransport rather than the network,
with payloads copied from a real Didit session observed on 2026-09-15. They exist because
three field names in this module were wrong for a year of mock-only development and every
one of them failed silently — degrading a handover rather than raising — which is exactly
the failure a test suite that only exercises the mock cannot see.
"""

import json
from typing import Any, Optional

import httpx
import pytest

from app.core.config import settings
from app.integrations import idvs as idvs_module
from app.integrations.idvs import (
    DiditIdvsClient,
    IdvsDecisionStatus,
    IdvsError,
    MockIdvsClient,
    _parse_decision,
)

_CALLBACK = "http://localhost:3002/h/tok-123"


def _stub_transport(monkeypatch, handler) -> None:
    """Route this module's httpx calls through a MockTransport.

    The client builds its own AsyncClient per call (deliberately — see its docstring), so
    there is no seam to inject a transport through. Wrapping the constructor keeps every
    real httpx behaviour these tests depend on: raise_for_status, .json(), header passing.
    """
    real_client = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(idvs_module.httpx, "AsyncClient", factory)


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

    first = await client.create_session(reference="handover-1", callback_url=_CALLBACK)
    second = await client.create_session(reference="handover-2", callback_url=_CALLBACK)

    assert first.session_id != second.session_id
    assert first.session_id in first.session_url


async def test_decision_defaults_to_approved_for_an_unstaged_session():
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1", callback_url=_CALLBACK)

    decision = await client.get_decision(session.session_id)

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.session_id == session.session_id


@pytest.fixture
def mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin IDVS_USE_MOCK on for tests that stage a mock decision.

    Without this these tests read the DEVELOPER'S .env: stage_decision() is guarded by
    _require_mock_mode(), so anyone running with IDVS_USE_MOCK=false — which is what you
    set to exercise live Didit locally — gets IdvsUnsupportedError and two red tests that
    have nothing to do with their change.

    It passed CI only by accident: CI checks out no .env at all, so the field fell back to
    its default of true. A unit test whose result depends on an untracked file on one
    machine is not testing what it claims to.
    """
    monkeypatch.setattr(settings, "IDVS_USE_MOCK", True)


async def test_staged_decline_is_returned_for_that_session_only(mock_mode):
    store = FakeStore()
    client = MockIdvsClient(store=store)
    declined = await client.create_session(reference="handover-1", callback_url=_CALLBACK)
    approved = await client.create_session(reference="handover-2", callback_url=_CALLBACK)

    await client.stage_decision(
        declined.session_id, status=IdvsDecisionStatus.DECLINED,
    )

    assert (await client.get_decision(declined.session_id)).status is IdvsDecisionStatus.DECLINED
    assert (await client.get_decision(approved.session_id)).status is IdvsDecisionStatus.APPROVED


async def test_staged_extracted_identity_is_returned(mock_mode):
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1", callback_url=_CALLBACK)

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



def test_parse_decision_reads_the_decision_endpoint_shape():
    """GET /v3/session/{id}/decision/ puts the feature arrays at the TOP level."""
    payload = {
        "session_id": "abc123",
        "status": "Approved",
        "id_verifications": [
            {
                "node_id": "id_verification_1",
                "status": "Approved",
                "first_name": "Thandi",
                "last_name": "Nkosi",
                "document_number": "9202204720082",
            }
        ],
    }

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


def test_parse_decision_reads_the_webhook_shape():
    """A webhook nests the same arrays under `decision`, beside the envelope fields."""
    payload = {
        "session_id": "abc123",
        "status": "Approved",
        "webhook_type": "status.updated",
        "vendor_data": "some-verification-id",
        "decision": {
            "id_verifications": [
                {"last_name": "Nkosi", "document_number": "9202204720082"},
            ],
        },
    }

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


def test_parse_decision_treats_a_null_id_verifications_array_as_nothing_to_compare():
    """Observed on a real session that had not completed: the arrays are null, not []."""
    payload = {"session_id": "abc123", "status": "Not Started", "id_verifications": None}

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.NOT_STARTED
    assert decision.extracted_surname is None
    assert decision.extracted_id_number is None


def test_parse_decision_does_not_fall_back_to_the_envelope_when_a_decision_block_is_empty():
    """An empty decision block means no document data — not "look upstairs instead"."""
    payload = {
        "session_id": "abc123",
        "status": "Abandoned",
        "id_verifications": [{"last_name": "Envelope", "document_number": "999"}],
        "decision": {"id_verifications": None},
    }

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.extracted_surname is None
    assert decision.extracted_id_number is None


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


# --- DiditIdvsClient against observed payloads --------------------------------


@pytest.fixture
def live_idvs(monkeypatch):
    """Configure the live client. Without this it refuses to call anything at all."""
    monkeypatch.setattr(settings, "IDVS_API_URL", "https://verification.didit.me")
    monkeypatch.setattr(settings, "IDVS_API_KEY", "test-key")
    monkeypatch.setattr(settings, "IDVS_WORKFLOW_ID", "workflow-uuid")
    return DiditIdvsClient()


async def test_create_session_reads_the_hosted_url_from_the_url_key(monkeypatch, live_idvs):
    """The observed POST /v3/session/ response. `url`, with no `session_url` present.

    Reading only `session_url` here — as this client originally did — raised IdvsError on
    every live call, which start_verification catches and turns into a degraded tier. The
    receiver was then waved past the identity check with no error anywhere.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session_id": "65c90eac-bd74-439b-8640-f314157b7f9b",
            "session_token": "yOAJdFu-Efbu",
            "url": "https://verify.didit.me/session/yOAJdFu-Efbu",
            "status": "Not Started",
        })

    _stub_transport(monkeypatch, handler)

    session = await live_idvs.create_session(reference="ref-1", callback_url=_CALLBACK)

    assert session.session_id == "65c90eac-bd74-439b-8640-f314157b7f9b"
    assert session.session_url == "https://verify.didit.me/session/yOAJdFu-Efbu"


async def test_create_session_still_accepts_the_session_url_spelling(monkeypatch, live_idvs):
    """The decision endpoint uses `session_url` for the same value; accept both."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session_id": "s-1", "session_url": "https://verify.didit.me/session/abc",
        })

    _stub_transport(monkeypatch, handler)

    session = await live_idvs.create_session(reference="ref-1", callback_url=_CALLBACK)

    assert session.session_url == "https://verify.didit.me/session/abc"


async def test_create_session_sends_the_callback_so_the_receiver_can_return(
    monkeypatch, live_idvs,
):
    """Without this the hosted flow ends on the vendor's domain and the receiver is lost."""
    sent: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={"session_id": "s-1", "url": "https://verify/x"})

    _stub_transport(monkeypatch, handler)

    await live_idvs.create_session(reference="ref-1", callback_url=_CALLBACK)

    assert sent["callback"] == _CALLBACK
    assert sent["vendor_data"] == "ref-1"
    assert sent["workflow_id"] == "workflow-uuid"


async def test_create_session_raises_when_no_hosted_url_comes_back(monkeypatch, live_idvs):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"session_id": "s-1"})

    _stub_transport(monkeypatch, handler)

    with pytest.raises(IdvsError):
        await live_idvs.create_session(reference="ref-1", callback_url=_CALLBACK)


async def test_get_decision_parses_a_real_decision_payload(monkeypatch, live_idvs):
    """The observed GET response shape, with the arrays populated as the vendor documents."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session_id": "s-1",
            "session_url": "https://verify.didit.me/session/abc",
            "status": "Approved",
            "id_verifications": [
                {"node_id": "id_verification_1", "last_name": "Nkosi",
                 "document_number": "9202204720082"},
            ],
            "liveness_checks": None,
            "face_matches": None,
        })

    _stub_transport(monkeypatch, handler)

    decision = await live_idvs.get_decision("s-1")

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


async def test_a_vendor_error_becomes_an_idvs_error_not_a_raw_httpx_error(
    monkeypatch, live_idvs,
):
    """orchestration degrades the tier on IdvsError; anything else would 500 the handover."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "upstream down"})

    _stub_transport(monkeypatch, handler)

    with pytest.raises(IdvsError):
        await live_idvs.create_session(reference="ref-1", callback_url=_CALLBACK)
