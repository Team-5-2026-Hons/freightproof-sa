"""Redis-backed request rate limiting, in two layers:

  * ``RateLimitMiddleware`` counts every request per client IP, before auth
    runs, so it blunts an anonymous flood cheaply.
  * ``rate_limit(...)`` builds a FastAPI dependency counting per authenticated
    subject on a named budget — the control that actually holds, since an
    attacker can change IP but not which account their token names.

Fixed-window counting: one Redis key per (bucket, identity, window index),
INCR'd and expiring with the window. Its known ~2x-at-boundary weakness is
irrelevant at budgets sized to stop sustained abuse, not to meter precisely.

**Fails open**: if Redis is unreachable the request is allowed (logged at
error level). Rate limiting is an availability control only — auth,
authorisation and tenancy are enforced elsewhere and don't depend on this
module, so failing open widens abuse-of-volume risk only, never data risk.
"""

import logging
import time
from collections.abc import Awaitable, Callable

import redis.asyncio as redis_async
from fastapi import HTTPException, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.client_ip import resolve_client_ip
from app.core.config import settings
from app.core.limits import GLOBAL_PER_IP, RateLimit

logger = logging.getLogger(__name__)

# Prefix so rate-limit keys are greppable and separable from other Redis users.
_KEY_PREFIX = "fp:ratelimit"

# Identical for every bucket: naming which budget was exhausted would tell an
# attacker which door is cheapest to probe.
RATE_LIMITED_DETAIL = "Too many requests. Please slow down and try again shortly."

# /health must never be throttled (orchestrator polls it and restarts a
# "dead" container on failure); docs routes are static and unauthenticated.
_MIDDLEWARE_EXEMPT_PATHS = frozenset({"/health", "/docs", "/redoc", "/openapi.json"})


_redis_client: redis_async.Redis | None = None


def _get_redis() -> redis_async.Redis:
    """Lazily build and cache the Redis client.

    Separate from core/realtime.py's client, which sets decode_responses=True
    for JSON pub/sub; this one wants raw integer INCR replies. Built lazily so
    importing this module doesn't require a reachable Redis.
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_async.from_url(settings.REDIS_URL)
    return _redis_client


def get_redis() -> redis_async.Redis:
    """Public accessor so callers (e.g. the /health probe) reuse this same
    connection instead of opening a second one to the same server."""
    return _get_redis()


def reset_client() -> None:
    """Drop the cached client so the next call rebuilds it. Tests only."""
    global _redis_client
    _redis_client = None


def _window_key(limit: RateLimit, identity: str) -> str:
    """The Redis key for `identity`'s counter in the CURRENT window of `limit`.

    Window index is floor(now / window_seconds), so the key rolls over and
    expires on its own — no sweeper, no stored window start.
    """
    window_index = int(time.time()) // limit.window_seconds
    return f"{_KEY_PREFIX}:{limit.name}:{identity}:{window_index}"


async def _count_and_check(limit: RateLimit, identity: str) -> bool:
    """Record one request against `identity`'s budget. True if within the limit.

    Returns True (allow) on any Redis failure — see module docstring, fails open.
    """
    key = _window_key(limit, identity)
    try:
        # INCR+TTL in one MULTI/EXEC. EXPIRE is set outside the transaction and
        # only when missing, so it never re-fires on every request (which would
        # keep pushing the window out and it would never roll over).
        pipe = _get_redis().pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        count, ttl = await pipe.execute()

        if ttl < 0:
            await _get_redis().expire(key, limit.window_seconds)
    except RedisError:
        logger.exception(
            "Rate limit check failed for bucket=%s identity=%s — allowing the request",
            limit.name, identity,
        )
        return True

    return int(count) <= limit.max_requests


def _client_identity(request: Request) -> str:
    """Best available identifier for an unauthenticated caller.

    Proxy-awareness lives in core/client_ip.py. "unknown" rather than None
    since this is a Redis key component — an undeterminable IP still needs a
    (shared, conservative) bucket.
    """
    return resolve_client_ip(request) or "unknown"


def _too_many_requests(limit: RateLimit) -> HTTPException:
    """Build the 429. Retry-After is the worst case — a full window from now."""
    return HTTPException(
        status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
        detail=RATE_LIMITED_DETAIL,
        headers={"Retry-After": str(limit.window_seconds)},
    )


def rate_limit(limit: RateLimit) -> Callable[[Request], Awaitable[None]]:
    """Build a FastAPI dependency enforcing `limit` per authenticated subject.

    Usage — declared alongside the auth dependency, never instead of it::

        @router.post("", dependencies=[Depends(rate_limit(TRIP_CREATE))])

    Identity comes from the raw bearer token, not the resolved user object, so
    this stays independent of which auth dependency runs and in what order.
    The token is NOT verified here — a forged token just buys its own private
    counter. No token falls back to IP, so an unauthenticated flood still counts.
    """

    async def dependency(request: Request) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return

        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            # Raw token, truncated — never leaves Redis, so no need to hash;
            # the leading 64 chars are already unique per session.
            identity = f"token:{authorization[7:][:64]}"
        else:
            identity = f"ip:{_client_identity(request)}"

        if not await _count_and_check(limit, identity):
            logger.warning("Rate limit exceeded: bucket=%s identity=%s", limit.name, identity)
            raise _too_many_requests(limit)

    return dependency


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Coarse per-IP limit applied to every non-exempt request.

    Middleware rather than a dependency because it must run before routing —
    a flood of requests to nonexistent paths should still be counted.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if not settings.RATE_LIMIT_ENABLED or request.url.path in _MIDDLEWARE_EXEMPT_PATHS:
            return await call_next(request)

        identity = f"ip:{_client_identity(request)}"
        if not await _count_and_check(GLOBAL_PER_IP, identity):
            logger.warning(
                "Global rate limit exceeded: identity=%s path=%s", identity, request.url.path,
            )
            # Built by hand: raising here bypasses FastAPI's HTTPException
            # handler (it sits below this middleware) and would 500 instead.
            return JSONResponse(
                status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": RATE_LIMITED_DETAIL},
                headers={"Retry-After": str(GLOBAL_PER_IP.window_seconds)},
            )

        return await call_next(request)
