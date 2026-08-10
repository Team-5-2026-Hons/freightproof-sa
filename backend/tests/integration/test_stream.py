"""Integration tests for the SSE stream endpoint (GET /api/v1/stream).

No live Redis and no DB: the auth-rejection paths return before any DB lookup, and the
success paths override get_current_dispatcher and monkeypatch realtime.subscribe with a
fake async generator — so these tests run anywhere, mirroring test_detail_receipts_gating.
"""

import asyncio
import uuid
from datetime import UTC, datetime

from app.api.v1.endpoints import stream as stream_mod
from app.core import realtime
from app.core.realtime import RealtimeKind, TripEvent
from app.db.models.enums import DispatcherRole
from app.schemas.people import UserRead
from tests.conftest import auth_header, make_token

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


def _dispatcher(org_id: uuid.UUID) -> UserRead:
    return UserRead(
        id=uuid.uuid4(),
        organization_id=org_id,
        email="dispatcher@fp.co.za",
        full_name="Test Dispatcher",
        is_active=True,
        created_at=_NOW,
        updated_at=_NOW,
        role=DispatcherRole.DISPATCHER,
    )


# ── Auth rejection (real dependency, HTTP path, no DB) ─────────────────────────


async def test_stream_without_credentials_returns_403(client):
    resp = await client.get("/api/v1/stream")

    assert resp.status_code == 403


async def test_stream_with_driver_token_returns_403(client):
    token = make_token(role="driver")

    resp = await client.get("/api/v1/stream", headers=auth_header(token))

    assert resp.status_code == 403


async def test_stream_with_expired_dispatcher_token_returns_401(client):
    token = make_token(role="dispatcher", expires_in=-1)

    resp = await client.get("/api/v1/stream", headers=auth_header(token))

    assert resp.status_code == 401


# ── Response shape (endpoint called directly) ─────────────────────────────────


async def test_stream_endpoint_returns_event_stream_response(monkeypatch):
    async def _fake_subscribe(_org_id):
        await asyncio.sleep(0)
        return
        yield  # pragma: no cover — marks this an async generator

    monkeypatch.setattr(realtime, "subscribe", _fake_subscribe)

    resp = await stream_mod.stream_endpoint(current_user=_dispatcher(uuid.uuid4()))

    assert resp.media_type == "text/event-stream"
    assert resp.headers["cache-control"] == "no-cache"


# ── Frame formatting + org isolation (generator exercised directly) ───────────


async def test_event_stream_delivers_event_as_a_data_frame(monkeypatch):
    org_id = uuid.uuid4()
    event = TripEvent(id=uuid.uuid4(), kind=RealtimeKind.PHASE_COMPLETED)

    async def _fake_subscribe(_org_id):
        yield event

    monkeypatch.setattr(realtime, "subscribe", _fake_subscribe)

    frames: list[str] = []
    async for frame in stream_mod._event_stream(org_id):
        frames.append(frame)
        if frame.startswith("data:"):
            break

    assert frames[0] == ": connected\n\n"
    data_frames = [f for f in frames if f.startswith("data:")]
    assert len(data_frames) == 1
    payload = data_frames[0].removeprefix("data: ").strip()
    assert TripEvent.model_validate_json(payload) == event


async def test_event_stream_subscribes_to_the_callers_org(monkeypatch):
    caller_org = uuid.uuid4()
    seen: dict[str, uuid.UUID] = {}

    async def _fake_subscribe(org_id):
        seen["org_id"] = org_id
        yield TripEvent(id=uuid.uuid4(), kind=RealtimeKind.TRIP_CREATED)

    monkeypatch.setattr(realtime, "subscribe", _fake_subscribe)

    async for frame in stream_mod._event_stream(caller_org):
        if frame.startswith("data:"):
            break

    # The endpoint must subscribe to the caller's own org channel — the isolation boundary.
    assert seen["org_id"] == caller_org


async def test_event_stream_emits_heartbeat_when_idle(monkeypatch):
    monkeypatch.setattr(stream_mod, "HEARTBEAT_SECONDS", 0.05)

    async def _idle_subscribe(_org_id):
        await asyncio.sleep(3600)  # never yields — forces the idle path
        yield  # pragma: no cover

    monkeypatch.setattr(realtime, "subscribe", _idle_subscribe)

    frames: list[str] = []
    async for frame in stream_mod._event_stream(uuid.uuid4()):
        frames.append(frame)
        if frame == ": heartbeat\n\n":
            break

    assert frames[0] == ": connected\n\n"
    assert ": heartbeat\n\n" in frames
