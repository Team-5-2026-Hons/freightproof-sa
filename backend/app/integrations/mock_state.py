"""Shared store for simulated external-world state, backed by Redis.

Why Redis and not a module-level dict: the FastAPI app and the Celery worker are
separate processes on the hosted deployment, and a hosted API typically runs
several worker processes. A staged waybill edit written into one process's memory
is invisible to the 60-second PP poll in app/tasks/parcel_perfect.py, which is a
different process entirely — so the "PP changed the manifest mid-trip" scenario
could never work in memory. Redis is already a hard dependency (it is the Celery
broker), so this costs no new package and no migration.

What lives here is the *outside world we are pretending to have*: what the
warehouse is about to report, and what the PP portal currently says. It is not
evidence. Every permanent effect of a trigger is written to PostgreSQL by
orchestration, and flushing this store leaves that evidence untouched — see
tests/integration/test_dev_triggers.py::test_flushing_mock_state_leaves_evidence_intact.

Layering: integrations → config only. Never imports from api/ or orchestration/.
"""

import json
import logging
from typing import Any, Protocol

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Every key this module writes is namespaced, so a flush can be scoped precisely
# and can never touch Celery's own broker keys in the same Redis instance.
MOCK_STATE_PREFIX = "freightproof:mock:"

# Staged state is demo scaffolding, not evidence. A day is far longer than any
# demo and short enough that abandoned state expires on its own.
MOCK_STATE_TTL_SECONDS = 60 * 60 * 24


def build_key(kind: str, *parts: str) -> str:
    """Build a namespaced Redis key. `kind` separates scan state from PP state."""
    return MOCK_STATE_PREFIX + ":".join([kind, *parts])


class MockStateStore(Protocol):
    """The storage contract MockScanFeed and the PP override layer depend on.

    A Protocol rather than a base class so tests can inject a dict-backed fake
    without pulling in a Redis test dependency.
    """

    async def get_json(self, key: str) -> dict[str, Any] | None: ...

    async def set_json(self, key: str, value: dict[str, Any]) -> None: ...

    async def flush(self) -> int: ...


class RedisMockStateStore:
    """MockStateStore over redis.asyncio, one short-lived connection per call.

    A connection per call rather than a pooled client: these calls happen only on
    dev-panel triggers (a handful per demo), and a module-level pool would bind to
    whichever event loop first touched it — which breaks under Celery's
    asyncio.run() per task and under pytest's function-scoped loops.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url

    async def get_json(self, key: str) -> dict[str, Any] | None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            raw = await client.get(key)
        finally:
            await client.aclose()
        if raw is None:
            return None
        try:
            parsed: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError:
            # Corrupt staged state is a bug in a writer, not a reason to fail a
            # demo. Log loudly and treat it as absent so the trigger still runs.
            logger.error("Corrupt mock state at key %s — treating as unset", key)
            return None
        return parsed

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            await client.set(key, json.dumps(value), ex=MOCK_STATE_TTL_SECONDS)
        finally:
            await client.aclose()

    async def flush(self) -> int:
        """Delete every namespaced mock key. Returns how many were removed.

        scan_iter, not keys(): keys() blocks Redis for the whole scan, and this
        shares an instance with the Celery broker.
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
