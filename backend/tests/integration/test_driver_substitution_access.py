"""FP-83 C2: who may act on a trip once custody can move.

The matrix runs every driver-facing live write and trip read against four kinds of caller on
one trip that went A -> B (B holds it, A is a former driver, C is only named on a pending
request, D belongs to another organisation). Current is allowed, a pending incoming driver and
a stranger get the same 404 (nothing disclosed), and a former driver gets the contract's coded
TRIP_HANDED_OVER conflict.
"""

import io
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import select

from app.db.models.enums import PhaseStatus
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.session import get_db
from app.main import app
from app.orchestration.phases.override import override_phase
from app.storage.supabase_storage import UploadResult
from tests.integration._driver_substitution_world import (
    SubWorld, add_pending, build_world, complete_handover, driver_headers,
)

JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 32


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture(autouse=True)
def fake_storage(monkeypatch):
    async def fake_upload(*, trip_id, file_bytes, mime_type):
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}", file_hash=uuid.uuid4().hex * 2,
        )

    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake_upload)


@pytest_asyncio.fixture
async def handed_over(db_session) -> SubWorld:
    """Trip A started, handed to B (sequence 1); C has a pending takeover of B's period."""
    world = await build_world(db_session)
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    await add_pending(
        db_session, world, outgoing=world.b, incoming=world.c,
        expected_at=datetime.now(UTC) + timedelta(hours=2),
    )
    return world


def _now() -> str:
    return datetime.now(UTC).isoformat()


Action = Callable[[AsyncClient, SubWorld, uuid.UUID, int | None], Awaitable[Response]]


def _seq(body: dict, seq: int | None) -> dict:
    return body if seq is None else {**body, "custody_sequence": seq}


async def _location(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    ping = {"lat": -26.09, "lng": 28.13, "accuracy_m": 8.0, "context": "/trips", "recorded_at": _now()}
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/locations", json=_seq({"pings": [ping]}, seq), headers=driver_headers(who),
    )


async def _checkpoint(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    body = {"checkpoint_type": "manual", "driver_phone_lat": 0.001, "driver_phone_lng": 0.001}
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/checkpoints", json=_seq(body, seq), headers=driver_headers(who),
    )


async def _exception(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    body = {"exception_type": "panic_button", "description": "Hijack suspected"}
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/exceptions", json=_seq(body, seq), headers=driver_headers(who),
    )


async def _artifact(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    data = {"trip_id": str(w.trip_id), "artifact_type": "photo", "captured_at": "2026-06-24T08:00:00Z"}
    if seq is not None:
        data["custody_sequence"] = str(seq)
    return await client.post(
        "/api/v1/artifacts", data=data, files={"file": ("p.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")},
        headers=driver_headers(who),
    )


def _activation_body(seq: int | None, key: str | None = None) -> dict:
    return _seq({
        "phase_type": "activation", "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
        "idempotency_key": key or str(uuid.uuid4()),
    }, seq)


async def _phase_complete(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/phases/{w.activation_id}/complete", json=_activation_body(seq),
        headers=driver_headers(who),
    )


async def _preview(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    body = {
        "driver_phone_lat": 0.0001, "driver_phone_lng": 0.0001, "driver_captured_at": _now(),
        "driver_accuracy_metres": 5.0,
    }
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/phases/{w.activation_id}/location-preview", json=body, headers=driver_headers(who),
    )


async def _issue_receiver_link(client: AsyncClient, w: SubWorld, who: uuid.UUID, seq: int | None) -> Response:
    query = "" if seq is None else f"?custody_sequence={seq}"
    return await client.post(
        f"/api/v1/trips/{w.trip_id}/phases/{w.confirmation_id}/handover/tokens{query}", headers=driver_headers(who),
    )


async def _get(client: AsyncClient, path: str, who: uuid.UUID) -> Response:
    return await client.get(path, headers=driver_headers(who))


async def _phases(client, w, who, seq):
    return await _get(client, f"/api/v1/trips/{w.trip_id}/phases", who)


async def _next_phase(client, w, who, seq):
    return await _get(client, f"/api/v1/trips/{w.trip_id}/phases/next", who)


async def _linehaul(client, w, who, seq):
    return await _get(client, f"/api/v1/trips/{w.trip_id}/manifest", who)


async def _route(client, w, who, seq):
    return await _get(client, f"/api/v1/trips/me/{w.trip_id}/route", who)


async def _own_detail(client, w, who, seq):
    return await _get(client, f"/api/v1/trips/me/{w.trip_id}", who)


ACTIONS: list[tuple[str, Action]] = [
    ("locations", _location), ("checkpoints", _checkpoint), ("exceptions", _exception),
    ("artifacts", _artifact), ("phase_complete", _phase_complete), ("location_preview", _preview),
    ("receiver_link", _issue_receiver_link), ("phases", _phases), ("phases_next", _next_phase),
    ("linehaul", _linehaul), ("route", _route), ("own_detail", _own_detail),
]


@pytest.mark.parametrize(("name", "call"), ACTIONS, ids=[name for name, _ in ACTIONS])
async def test_current_driver_is_allowed(client: AsyncClient, handed_over: SubWorld, name: str, call: Action):
    response = await call(client, handed_over, handed_over.b, 1)

    assert response.status_code < 300, response.text


@pytest.mark.parametrize(("name", "call"), ACTIONS, ids=[name for name, _ in ACTIONS])
async def test_former_driver_gets_the_coded_conflict(client: AsyncClient, handed_over: SubWorld, name: str, call: Action):
    response = await call(client, handed_over, handed_over.a, 0)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "TRIP_HANDED_OVER"


@pytest.mark.parametrize(("name", "call"), ACTIONS, ids=[name for name, _ in ACTIONS])
async def test_pending_incoming_driver_cannot_use_normal_routes(
    client: AsyncClient, handed_over: SubWorld, name: str, call: Action,
):
    response = await call(client, handed_over, handed_over.c, 1)

    assert response.status_code == 404, response.text


@pytest.mark.parametrize(("name", "call"), ACTIONS, ids=[name for name, _ in ACTIONS])
async def test_unrelated_driver_gets_a_plain_404(client: AsyncClient, handed_over: SubWorld, name: str, call: Action):
    response = await call(client, handed_over, handed_over.d, 1)

    assert response.status_code == 404, response.text
    assert "code" not in str(response.json().get("detail"))



async def test_omitted_sequence_is_accepted_only_before_any_substitution(client: AsyncClient, db_session):
    world = await build_world(db_session)

    before = await _exception(client, world, world.a, None)
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    after = await _exception(client, world, world.b, None)

    assert before.status_code == 201, before.text
    assert after.status_code == 409
    assert after.json()["detail"]["code"] == "CUSTODY_CONTEXT_REQUIRED"


async def test_old_capture_is_not_current_after_driver_returns(client: AsyncClient, db_session):
    world = await build_world(db_session)
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    await complete_handover(db_session, world, outgoing=world.b, incoming=world.a)

    stale = await _phase_complete(client, world, world.a, 0)

    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "CUSTODY_CONTEXT_CHANGED"
    event = (await db_session.execute(select(PhaseEvent).where(PhaseEvent.id == world.activation_id))).scalar_one()
    assert event.status == "pending"
    assert event.performed_by_driver_id is None and event.custody_sequence is None
    fresh = await _phase_complete(client, world, world.a, 2)
    assert fresh.status_code == 200, fresh.text
    await db_session.refresh(event)
    assert (event.performed_by_driver_id, event.custody_sequence) == (world.a, 2)


async def test_exact_retry_is_accepted_before_a_stale_sequence_is_rejected(client: AsyncClient, db_session):
    world = await build_world(db_session)
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    await complete_handover(db_session, world, outgoing=world.b, incoming=world.a)
    key = str(uuid.uuid4())
    url = f"/api/v1/trips/{world.trip_id}/phases/{world.activation_id}/complete"
    first = await client.post(url, json=_activation_body(2, key), headers=driver_headers(world.a))

    retry = await client.post(url, json=_activation_body(0, key), headers=driver_headers(world.a))
    other_key = await client.post(url, json=_activation_body(0), headers=driver_headers(world.a))

    assert first.status_code == 200, first.text
    assert retry.status_code == 200, retry.text
    assert other_key.status_code == 409
    assert other_key.json()["detail"]["code"] == "CUSTODY_CONTEXT_CHANGED"



async def test_former_driver_exact_replay_has_no_current_trip_data(client: AsyncClient, db_session):
    world = await build_world(db_session)
    key = str(uuid.uuid4())
    url = f"/api/v1/trips/{world.trip_id}/phases/{world.activation_id}/complete"
    accepted = await client.post(url, json=_activation_body(None, key), headers=driver_headers(world.a))
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)

    replay = await client.post(url, json=_activation_body(0, key), headers=driver_headers(world.a))
    changed_key = await client.post(url, json=_activation_body(0), headers=driver_headers(world.a))
    other_actor = await client.post(url, json=_activation_body(1, key), headers=driver_headers(world.b))
    stranger = await client.post(url, json=_activation_body(1, key), headers=driver_headers(world.d))

    assert accepted.status_code == 200, accepted.text
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "EVIDENCE_ALREADY_RECORDED"
    assert replay.json()["detail"]["evidence_id"] == str(world.activation_id)
    assert set(replay.json()["detail"]) == {"code", "message", "evidence_id"}
    assert changed_key.json()["detail"]["code"] == "TRIP_HANDED_OVER"
    assert other_actor.status_code == 409
    other_detail = other_actor.json()["detail"]
    assert not (isinstance(other_detail, dict) and other_detail.get("code") == "EVIDENCE_ALREADY_RECORDED")
    assert "phases" not in other_actor.text
    assert stranger.status_code == 404


async def test_former_driver_exception_replay_is_acknowledged_by_opaque_reference(client: AsyncClient, db_session):
    world = await build_world(db_session)
    report_id = str(uuid.uuid4())
    body = {"exception_type": "panic_button", "description": "Hijack suspected", "client_report_id": report_id}
    url = f"/api/v1/trips/{world.trip_id}/exceptions"
    accepted = await client.post(url, json=body, headers=driver_headers(world.a))
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)

    replay = await client.post(url, json={**body, "custody_sequence": 0}, headers=driver_headers(world.a))
    other_actor = await client.post(url, json={**body, "custody_sequence": 1}, headers=driver_headers(world.b))

    assert accepted.status_code == 201, accepted.text
    assert replay.status_code == 409
    assert replay.json()["detail"] == {
        "code": "EVIDENCE_ALREADY_RECORDED",
        "message": replay.json()["detail"]["message"],
        "evidence_id": accepted.json()["id"],
    }
    assert other_actor.status_code != 200 and other_actor.status_code != 201
    stored = (await db_session.execute(select(TripException).where(TripException.trip_id == world.trip_id))).scalars().all()
    assert len(stored) == 1
    assert (stored[0].performed_by_driver_id, stored[0].custody_sequence) == (world.a, 0)


async def test_former_driver_checkpoint_replay_is_acknowledged_by_opaque_reference(client: AsyncClient, db_session):
    world = await build_world(db_session)
    report_id = str(uuid.uuid4())
    body = {"checkpoint_type": "manual", "driver_phone_lat": 0.001, "driver_phone_lng": 0.001, "client_report_id": report_id}
    url = f"/api/v1/trips/{world.trip_id}/checkpoints"
    accepted = await client.post(url, json=body, headers=driver_headers(world.a))
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)

    replay = await client.post(url, json={**body, "custody_sequence": 0}, headers=driver_headers(world.a))

    assert accepted.status_code == 201, accepted.text
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "EVIDENCE_ALREADY_RECORDED"
    assert replay.json()["detail"]["evidence_id"] == accepted.json()["id"]
    stored = (await db_session.execute(select(Checkpoint).where(Checkpoint.trip_id == world.trip_id))).scalars().all()
    assert [(c.performed_by_driver_id, c.custody_sequence) for c in stored] == [(world.a, 0)]


async def test_no_substitution_trip_keeps_its_legacy_replay_semantics(client: AsyncClient, db_session):
    world = await build_world(db_session)
    key = str(uuid.uuid4())
    url = f"/api/v1/trips/{world.trip_id}/phases/{world.activation_id}/complete"

    first = await client.post(url, json=_activation_body(None, key), headers=driver_headers(world.a))
    replay = await client.post(url, json=_activation_body(None, key), headers=driver_headers(world.a))
    different_key = await client.post(url, json=_activation_body(None), headers=driver_headers(world.a))

    assert (first.status_code, replay.status_code, different_key.status_code) == (200, 200, 200)



async def test_current_driver_capture_for_overridden_phase_after_handover_returns_phase_overridden(
    client: AsyncClient, db_session,
):
    """After a handover the resolved-row guard runs before the phase gate. An overridden row must
    still answer the coded PHASE_OVERRIDDEN, not "already completed by another submission": the
    driver app's offline queue keeps the capture and keeps draining only on that code."""
    world = await build_world(db_session)
    await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    await override_phase(
        db_session, trip_id=world.trip_id, phase_event_id=world.activation_id,
        operator_organization_id=world.org_id, user_id=world.user_id, note="Driver phone lost",
    )

    resp = await _phase_complete(client, world, world.b, 1)

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "PHASE_OVERRIDDEN"
    event = (await db_session.execute(select(PhaseEvent).where(PhaseEvent.id == world.activation_id))).scalar_one()
    await db_session.refresh(event)
    assert event.status == PhaseStatus.OVERRIDDEN
    assert event.performed_by_driver_id is None and event.custody_sequence is None
