"""Unit tests for the realtime event bus (app/core/realtime.py).

Pure logic only — no live Redis. The Redis client accessor is monkeypatched with an
in-memory fake (mirroring how the PP client tests mock httpx with respx), so the
publish/subscribe wrappers and the after-commit outbox are exercised without infra.
"""

from types import SimpleNamespace
from uuid import uuid4

from app.core import realtime
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event


# ── TripEvent + channel ───────────────────────────────────────────────────────


def test_trip_event_json_roundtrip_preserves_all_fields():
    event = TripEvent(id=uuid4(), kind=RealtimeKind.PHASE_COMPLETED)

    parsed = TripEvent.model_validate_json(event.model_dump_json())

    assert parsed == event


def test_trip_event_defaults_resource_to_trip():
    event = TripEvent(id=uuid4(), kind=RealtimeKind.EXCEPTION_RAISED)

    assert event.resource == "trip"


def test_channel_key_uses_org_prefix():
    org_id = uuid4()

    assert realtime._channel(org_id) == f"org:{org_id}"


# ── Outbox: enqueue / drain / rollback (D9) ───────────────────────────────────


def test_enqueue_event_appends_to_session_outbox():
    session = SimpleNamespace(info={})
    org_id = uuid4()
    event = TripEvent(id=uuid4(), kind=RealtimeKind.TRIP_CREATED)

    enqueue_event(session, org_id, event)
    enqueue_event(session, org_id, event)

    assert session.info["realtime_outbox"] == [(org_id, event), (org_id, event)]


def test_drain_outbox_emits_each_event_and_pops_the_outbox():
    org_id = uuid4()
    event = TripEvent(id=uuid4(), kind=RealtimeKind.PHASE_COMPLETED)
    info = {"realtime_outbox": [(org_id, event)]}
    emitted: list[tuple] = []

    realtime._drain_outbox(info, lambda o, e: emitted.append((o, e)))

    assert emitted == [(org_id, event)]
    # Popped, not just read — a second commit on the same session must not re-publish.
    assert "realtime_outbox" not in info


def test_drain_outbox_no_op_when_empty():
    info: dict = {}
    emitted: list[tuple] = []

    realtime._drain_outbox(info, lambda o, e: emitted.append((o, e)))

    assert emitted == []


def test_on_rollback_discards_outbox_without_emitting():
    org_id = uuid4()
    event = TripEvent(id=uuid4(), kind=RealtimeKind.PHASE_COMPLETED)
    session = SimpleNamespace(info={"realtime_outbox": [(org_id, event)]})

    realtime._on_rollback(session)

    assert "realtime_outbox" not in session.info


# ── publish_event / subscribe over a fake Redis ───────────────────────────────


class _FakePubSub:
    def __init__(self, messages: list[dict]):
        self._messages = messages
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def aclose(self) -> None:
        self.closed = True

    async def listen(self):
        for message in self._messages:
            yield message


class _FakeRedis:
    def __init__(self, messages: list[dict] | None = None):
        self.published: list[tuple[str, str]] = []
        self._pubsub = _FakePubSub(messages or [])

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, payload))

    def pubsub(self) -> _FakePubSub:
        return self._pubsub


async def test_publish_event_publishes_json_to_the_org_channel(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(realtime, "_get_redis", lambda: fake)
    org_id = uuid4()
    event = TripEvent(id=uuid4(), kind=RealtimeKind.TRIP_CLOSED)

    await realtime.publish_event(org_id, event)

    assert len(fake.published) == 1
    channel, payload = fake.published[0]
    assert channel == f"org:{org_id}"
    assert TripEvent.model_validate_json(payload) == event


async def test_subscribe_yields_parsed_events_and_cleans_up(monkeypatch):
    org_id = uuid4()
    event = TripEvent(id=uuid4(), kind=RealtimeKind.EXCEPTION_RAISED)
    messages = [
        {"type": "subscribe", "data": 1},  # confirmation frame — must be ignored
        {"type": "message", "data": event.model_dump_json()},
    ]
    fake = _FakeRedis(messages)
    monkeypatch.setattr(realtime, "_get_redis", lambda: fake)

    received = [e async for e in realtime.subscribe(org_id)]

    assert received == [event]
    assert fake._pubsub.subscribed == [f"org:{org_id}"]
    # The generator's finally-block must have torn the subscription down.
    assert fake._pubsub.unsubscribed == [f"org:{org_id}"]
    assert fake._pubsub.closed is True


# ── Fail-open publish ─────────────────────────────────────────────────────────


async def test_safe_publish_swallows_redis_errors(monkeypatch):
    async def boom(_org_id, _event):
        raise ConnectionError("redis down")

    monkeypatch.setattr(realtime, "publish_event", boom)

    # Must not raise: a broker failure cannot surface on the driver's committed write.
    await realtime._safe_publish(uuid4(), TripEvent(id=uuid4(), kind=RealtimeKind.PHASE_COMPLETED))


# ── Hook registration ─────────────────────────────────────────────────────────


def test_register_realtime_hook_is_idempotent():
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    realtime.register_realtime_hook()
    realtime.register_realtime_hook()

    # Attached exactly once despite two calls.
    assert event.contains(Session, "after_commit", realtime._on_commit)
    assert event.contains(Session, "after_rollback", realtime._on_rollback)
