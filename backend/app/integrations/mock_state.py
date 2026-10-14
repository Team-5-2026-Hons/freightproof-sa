"""Shared store for simulated external-world state, backed by Redis.

Redis, not a module-level dict: the FastAPI app and Celery worker are
separate processes, so a staged edit must be visible across both (e.g. the
60s PP poll in app/tasks/parcel_perfect.py). Redis is already a hard
dependency (the Celery broker), so this costs nothing extra.

What lives here is the *outside world we are pretending to have*, not
evidence — every permanent effect is written to PostgreSQL by orchestration,
and flushing this store leaves that evidence untouched (see
tests/integration/test_dev_triggers.py::test_flushing_mock_state_leaves_evidence_intact).

Layering: integrations → config only.
"""

import json
import logging
from typing import Any, Protocol

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Namespaced so a flush is scoped precisely and never touches Celery's own
# broker keys in the same Redis instance.
MOCK_STATE_PREFIX = "freightproof:mock:"

# Demo scaffolding, not evidence — long enough for any demo, short enough
# that abandoned state expires on its own.
MOCK_STATE_TTL_SECONDS = 60 * 60 * 24


def build_key(kind: str, *parts: str) -> str:
    """Build a namespaced Redis key. `kind` separates scan state from PP state."""
    return MOCK_STATE_PREFIX + ":".join([kind, *parts])


class MockStateStore(Protocol):
    """The storage contract MockScanFeed and the PP override layer depend on.

    A Protocol so tests can inject a dict-backed fake without a Redis test dependency.
    """

    async def get_json(self, key: str) -> dict[str, Any] | None: ...

    async def get_many_json(self, keys: list[str]) -> list[dict[str, Any] | None]:
        """Read many keys at once, returning one result per key, in order.

        On the contract, not a Redis-only convenience: the phase gate reads
        a key per consignment per gated phase on every trip-detail request,
        which as a loop of get_json would cost a connection per consignment.
        """
        ...

    async def set_json(self, key: str, value: dict[str, Any]) -> None: ...

    async def flush(self) -> int: ...


class RedisMockStateStore:
    """MockStateStore over redis.asyncio, one short-lived connection per call.

    A connection per call, not a pooled client: a module-level pool would
    bind to whichever event loop first touched it, breaking under Celery's
    asyncio.run() per task and pytest's function-scoped loops. So anything on
    the phase-gate read path must batch through get_many_json, not loop over
    get_json, or a trip pays a connection per consignment per gated phase.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url

    @staticmethod
    def _decode(key: str, raw: str | None) -> dict[str, Any] | None:
        """Parse one stored value. Absent and corrupt both read as unset."""
        if raw is None:
            return None
        try:
            parsed: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError:
            # A writer bug, not a reason to fail a demo — log loudly, treat as absent.
            logger.error("Corrupt mock state at key %s — treating as unset", key)
            return None
        return parsed

    async def get_json(self, key: str) -> dict[str, Any] | None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            raw = await client.get(key)
        finally:
            await client.aclose()
        return self._decode(key, raw)

    async def get_many_json(self, keys: list[str]) -> list[dict[str, Any] | None]:
        if not keys:
            # MGET with no arguments errors, and "nothing to gate" is common.
            return []
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            raws = await client.mget(keys)
        finally:
            await client.aclose()
        # strict=True: a length mismatch means a broken client, not something to paper over.
        return [self._decode(key, raw) for key, raw in zip(keys, raws, strict=True)]

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            await client.set(key, json.dumps(value), ex=MOCK_STATE_TTL_SECONDS)
        finally:
            await client.aclose()

    async def flush(self) -> int:
        """Delete every namespaced mock key. Returns how many were removed.

        scan_iter, not keys(): keys() blocks Redis for the whole scan on an
        instance shared with the Celery broker.
        """
        client = redis.from_url(self._redis_url, decode_responses=True)
        deleted = 0
        try:
            async for key in client.scan_iter(match=f"{MOCK_STATE_PREFIX}*"):
                deleted += await client.delete(key)
        finally:
            await client.aclose()
        logger.info("Flushed %d mock-state key(s)", deleted)
        return deleted


def get_mock_state_store() -> MockStateStore:
    """Return the mock-state store. Mirrors get_pp_client()'s factory shape."""
    return RedisMockStateStore(settings.REDIS_URL)
