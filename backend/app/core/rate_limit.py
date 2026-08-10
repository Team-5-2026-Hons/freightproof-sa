"""Redis-backed request rate limiting.

Two layers, because one is not enough:

  * ``RateLimitMiddleware`` counts every request per client IP. It runs before
    authentication, so it is the only thing standing between an anonymous flood and the
    JWKS fetch + DB round-trip that a 401 still costs us.
  * ``rate_limit(...)`` produces a FastAPI dependency that counts per authenticated
    subject on a named budget. This is the control that actually holds: an attacker
    holding a valid token defeats an IP limit by changing IP, but cannot change which
    account the token names.

Counting is a fixed window: one Redis key per (bucket, identity, window index), INCR on
each request, key expires with the window. Fixed rather than sliding on purpose — it is
two Redis commands and one integer, it is trivially explainable, and its known weakness
(up to 2x the budget across a window boundary) is irrelevant at budgets sized to stop
sustained abuse rather than to meter precisely.

**This fails open.** If Redis is unreachable the request is allowed and the failure is
logged at error level. That is a deliberate trade: rate limiting is an availability
control, and on an evidence platform a Redis blip must not stop a driver at a depot gate
from recording what happened. Authentication, authorisation and tenancy are all enforced
elsewhere and none of them depend on this module, so a failed-open limiter widens the
door to abuse-of-volume only — never to data.
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

from app.core.config import settings
from app.core.limits import GLOBAL_PER_IP, RateLimit

logger = logging.getLogger(__name__)

# Prefix for every counter key, so rate-limit state is greppable and separable from the
# Celery queues and mock-state keys sharing this Redis instance.
_KEY_PREFIX = "fp:ratelimit"

# Returned as the 429 body. Deliberately identical for every bucket: telling a caller
# WHICH budget they exhausted tells an attacker which door is cheapest to probe.
RATE_LIMITED_DETAIL = "Too many requests. Please slow down and try again shortly."

# Paths the middleware never counts. /health is polled by the container orchestrator on a
# fixed interval and must never be throttled — a rate-limited health check reads as a dead
# container and gets the service restarted. The docs routes are static and unauthenticated.
_MIDDLEWARE_EXEMPT_PATHS = frozenset({"/health", "/docs", "/redoc", "/openapi.json"})

# Header name for the proxy-supplied client IP. Only consulted when the deployment
# declares a trusted proxy — see _client_identity.
_FORWARDED_FOR_HEADER = "x-forwarded-for"


_redis_client: redis_async.Redis | None = None


def _get_redis() -> redis_async.Redis:
    """Lazily build and cache the Redis client.

    Mirrors core/realtime.py's client rather than sharing it: that one sets
    decode_responses=True for JSON pub/sub payloads, and this one wants raw integer
    replies from INCR. Building at import time would couple module import to a reachable
    Redis, which would break every test that never touches rate limiting.
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_async.from_url(settings.REDIS_URL)
    return _redis_client


def reset_client() -> None:
    """Drop the cached client so the next call rebuilds it. Tests only."""
    global _redis_client
    _redis_client = None


def _window_key(limit: RateLimit, identity: str) -> str:
    """The Redis key for `identity`'s counter in the CURRENT window of `limit`.

    The window index is floor(now / window_seconds), so the key changes on its own as time
    passes and the old key expires unaided. No sweeper, no stored window start.
    """
    window_index = int(time.time()) // limit.window_seconds
    return f"{_KEY_PREFIX}:{limit.name}:{identity}:{window_index}"


async def _count_and_check(limit: RateLimit, identity: str) -> bool:
    """Record one request against `identity`'s budget. True if it is within the limit.

    Returns True (allow) on any Redis failure — see the module docstring on failing open.
    """
    key = _window_key(limit, identity)
    try:
        # INCR and TTL in one MULTI/EXEC so the count and its expiry state are read
        # together. The follow-up EXPIRE is outside the transaction because it only runs
        # on the first request of a window (or if a TTL was somehow lost); setting it
        # unconditionally on every request would keep pushing the expiry out and the
        # window would never roll over under sustained load — which is precisely the case
        # the limit exists for.
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

    X-Forwarded-For is honoured ONLY when the deployment declares it sits behind a proxy
    it trusts. Reading that header unconditionally would make the limit worthless: any
    caller could send a fresh value per request and get a fresh budget each time. When the
    setting is off, the socket peer address is used, which cannot be forged over TCP.
    """
    if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
        forwarded = request.headers.get(_FORWARDED_FOR_HEADER)
        if forwarded:
            # Left-most entry is the original client; the rest are proxy hops.
            return forwarded.split(",")[0].strip()

    return request.client.host if request.client else "unknown"


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

    Identity comes from the request's own bearer token rather than from the resolved user
    object, so this dependency stays independent of which auth dependency the endpoint
    uses (dispatcher, driver, or admin) and FastAPI is free to resolve them in any order.
    The token is NOT verified here — that is the auth dependency's job, and a forged token
    buys an attacker nothing but their own private counter. Callers with no token at all
    fall back to their IP, so an unauthenticated flood is still counted.
    """

    async def dependency(request: Request) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return

        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            # The token itself, not a parsed claim: hashing is unnecessary (this never
            # leaves Redis) and parsing would duplicate auth logic. Truncated because a
            # full JWT makes for an unwieldy key and the leading segment is already
            # unique per session.
            identity = f"token:{authorization[7:][:64]}"
        else:
            identity = f"ip:{_client_identity(request)}"

        if not await _count_and_check(limit, identity):
            logger.warning("Rate limit exceeded: bucket=%s identity=%s", limit.name, identity)
            raise _too_many_requests(limit)

    return dependency


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Coarse per-IP limit applied to every request that is not explicitly exempt.

    Middleware rather than a global dependency because it has to run before routing: a
    flood aimed at paths that do not exist should be counted too, and a dependency on a
    matched route never sees those.
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
            # Built by hand rather than raised: an exception from middleware bypasses
            # FastAPI's HTTPException handler (that handler is registered on the inner
            # ExceptionMiddleware, which sits below this one in the stack) and would
            # surface as a 500 instead of a 429.
            return JSONResponse(
                status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": RATE_LIMITED_DETAIL},
                headers={"Retry-After": str(GLOBAL_PER_IP.window_seconds)},
            )

        return await call_next(request)
