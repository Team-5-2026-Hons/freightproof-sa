# FreightProof SA — FastAPI application entry point
# This is the root of the backend. All routers will be registered here
# as the API is built out. CORS is configured here for frontend access.

import asyncio
import logging
from typing import Literal

from fastapi import Depends, FastAPI, Request, Response
from fastapi import status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.rate_limit import RateLimitMiddleware, get_redis
from app.core.security_headers import SecurityHeadersMiddleware
from app.api.v1.endpoints.artifacts import router as artifacts_router
from app.api.v1.endpoints.artifacts import trip_artifacts_router
from app.api.v1.endpoints.blockchain import router as blockchain_router
from app.api.v1.endpoints.checkpoints import router as checkpoints_router
from app.api.v1.endpoints.dev_triggers import dev_panel_enabled
from app.api.v1.endpoints.dev_triggers import router as dev_triggers_router
from app.api.v1.endpoints.drivers import router as drivers_router
from app.api.v1.endpoints.exceptions import router as exceptions_router
from app.api.v1.endpoints.locations import router as locations_router
from app.api.v1.endpoints.manifest import router as manifest_router
from app.api.v1.endpoints.phases import router as phases_router
from app.api.v1.endpoints.pp import router as pp_router
from app.api.v1.endpoints.precincts import router as precincts_router
from app.api.v1.endpoints.stream import router as stream_router
from app.api.v1.endpoints.trip_admin import router as trip_admin_router
from app.api.v1.endpoints.trips import router as trips_router
from app.api.v1.endpoints.vehicles import router as vehicles_router
from app.auth.router import router as auth_router
from app.core.realtime import register_realtime_hook
from app.db.session import get_db

logger = logging.getLogger(__name__)

_IS_PRODUCTION = settings.ENVIRONMENT == "production"

# Interactive docs are a complete, self-updating map of the attack surface: every route,
# every request shape, every field name. Useful in development, gratuitous in production
# where nothing legitimate reads them. Passing None removes the routes entirely rather
# than guarding them, so there is nothing left to misconfigure. openapi_url has to go too
# — leaving it would serve the same map as raw JSON with the browsers' UIs merely absent.
app = FastAPI(
    title="FreightProof SA",
    description="Cargo theft and disputed delivery evidence platform",
    version=settings.VERSION,
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)

# A wildcard origin combined with allow_credentials is the browser-side equivalent of no
# CORS policy at all: any site a signed-in dispatcher visits could call this API with
# their credentials attached. Browsers reject that exact combination, so it would fail
# loudly rather than silently — but only at the moment a real user was already exposed to
# the misconfiguration. Refusing to boot moves that discovery to deploy time.
if _IS_PRODUCTION and "*" in settings.ALLOWED_ORIGINS:
    raise RuntimeError(
        "ALLOWED_ORIGINS may not contain '*' when ENVIRONMENT='production'. "
        "List the dispatcher and driver origins explicitly."
    )

# Rate limiting, applied to every request before routing — so a flood aimed at paths that
# do not exist is counted too, which a route dependency would never see.
#
# Registration order note, because it is the opposite of what it looks like: Starlette's
# add_middleware INSERTS AT THE FRONT of the stack, so the middleware added LAST ends up
# outermost. CORS is added after this line and therefore wraps it.
#
# That is the order we want. A 429 returned from inside the CORS layer still gets its
# CORS headers on the way out, so a throttled browser can actually read the response and
# show the driver or dispatcher why they were refused. Were the rate limiter outermost,
# its 429 would carry no CORS headers and the app would see an opaque network failure
# instead of a rate limit.
app.add_middleware(RateLimitMiddleware)

# CORS is configured here rather than per-router so that all endpoints
# inherit the same origin policy. In production, ALLOWED_ORIGINS will
# be restricted to the actual domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last so it is outermost of all three — a response leaving through the rate
# limiter's 429 or a CORS rejection still gets these headers, not just a normal 2xx.
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(trips_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(drivers_router, prefix="/api/v1")
app.include_router(vehicles_router, prefix="/api/v1")
app.include_router(precincts_router, prefix="/api/v1")
app.include_router(blockchain_router, prefix="/api/v1")
app.include_router(phases_router, prefix="/api/v1")
app.include_router(artifacts_router, prefix="/api/v1")
app.include_router(trip_artifacts_router, prefix="/api/v1")
app.include_router(exceptions_router, prefix="/api/v1")
app.include_router(locations_router, prefix="/api/v1")
app.include_router(checkpoints_router, prefix="/api/v1")
app.include_router(manifest_router, prefix="/api/v1")
app.include_router(pp_router, prefix="/api/v1")
app.include_router(stream_router, prefix="/api/v1")
app.include_router(trip_admin_router, prefix="/api/v1")

# Dev trigger panel. Registered when DEV_PANEL_ENABLED is set — and ONLY that, since the
# deployed demo host runs ENVIRONMENT="production" and still needs the panel to drive the
# scan and Parcel Perfect flows. It is not tied to the _IS_PRODUCTION checks above: those
# keep /docs and /openapi.json unpublished regardless of this flag, which is exactly why
# the two are separate. See dev_triggers.dev_panel_enabled() for the full reasoning and
# what protection remains.
#
# These endpoints fabricate scans and exceptions on an evidence platform. When the flag is
# off the router is never registered, so the paths do not exist rather than being guarded
# — but the flag is now the only thing making that so. Treat it as production config of
# the same weight as a credential.
if dev_panel_enabled():
    app.include_router(dev_triggers_router, prefix="/api/v1")

# Attach the SQLAlchemy after-commit listeners that publish queued realtime events
# once a request's transaction is durable (see app/core/realtime.py). Idempotent, and
# a no-op for any session that never enqueued an event.
register_realtime_hook()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort net for anything that reaches this far uncaught — a DB fault an
    endpoint didn't catch, or a genuine bug — so a caller always gets a clean JSON
    500 instead of an ASGI-server-specific bare error page, and the traceback is
    never lost.

    Registering on the bare `Exception` class hooks Starlette's ServerErrorMiddleware
    (FastAPI splits `exception_handlers` at startup: only `Exception`/500 goes there,
    everything else goes to the inner ExceptionMiddleware). `HTTPException` and
    `RequestValidationError` both already have handlers registered on that INNER
    middleware (FastAPI's own defaults) and are fully resolved to a response there —
    they never propagate out to ServerErrorMiddleware, so this handler structurally
    cannot see or swallow them. Deliberately not narrowed to a `try/except` here,
    since narrowing would defeat the point: verified explicitly by
    test_global_handler_preserves_http_exceptions (404 and 422 both still surface).
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )


# ── Health check ──────────────────────────────────────────────────────────────
# A health endpoint that answers 200 out of process memory only proves the process is
# running, which is the one failure mode an orchestrator can already see for itself. The
# outages that actually take FreightProof down leave the process perfectly alive: Supabase
# drops the connection pool, or Redis goes away and takes the rate limiter and the realtime
# bus with it. So this endpoint reaches for both dependencies on every call and reports
# what came back.

_DB_PROBE = text("SELECT 1")

# The literals that appear in the response body, named so the endpoint, the models and the
# tests cannot drift apart on a typo.
_STATUS_OK = "ok"
_STATUS_DEGRADED = "degraded"
_PROBE_OK = "ok"
_PROBE_UNAVAILABLE = "unavailable"

# Probe names, which are also the keys of HealthResponse.checks.
_CHECK_DATABASE = "database"
_CHECK_REDIS = "redis"


class DependencyHealth(BaseModel):
    """One dependency's probe result."""

    status: Literal["ok", "unavailable"]

    # The exception CLASS name, never its message. /health is unauthenticated by design
    # (the orchestrator polling it holds no credentials), and a connection error's message
    # routinely carries the DSN — host, port, and sometimes the user. "ConnectionRefusedError"
    # is all an operator needs to reach for the right log; the detail is in that log, behind
    # auth, where it belongs.
    error: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    environment: str
    version: str
    checks: dict[str, DependencyHealth]


async def _probe_database(db: AsyncSession) -> DependencyHealth:
    """Round-trip the smallest possible query against Postgres.

    Uses the request's injected session, so this exercises the same engine and pool the
    endpoints use — a probe holding a private connection could pass while every real
    request was starving on an exhausted pool.
    """
    try:
        await asyncio.wait_for(
            db.execute(_DB_PROBE),
            timeout=settings.HEALTH_PROBE_TIMEOUT_SECONDS,
        )
    # Broad on purpose, and the one place in this codebase where that is right: a health
    # check whose own failure path raises is worse than no health check, because it turns
    # a legible "degraded" into a 500 that names no dependency. A timeout arrives as
    # asyncio.TimeoutError, driver and connection faults as DBAPIError, a session already
    # poisoned earlier in the request as InvalidRequestError — all of them mean the same
    # thing here, and none is swallowed: each is logged with its traceback and reported.
    except Exception as exc:
        logger.exception("Health probe failed: database unreachable")
        # A failed statement leaves the session in a transaction that can no longer be
        # committed, and get_db() commits unconditionally once this handler returns.
        # Without this rollback the endpoint would still 500 — after correctly working
        # out that the answer was 503.
        #
        # Bounded by the same ceiling as the probe itself, because the case that brought
        # us here is usually a database that hangs rather than one that refuses: ROLLBACK
        # has to travel the same dead connection the query just timed out on, so an
        # unbounded rollback would hand back the hang that wait_for above just escaped.
        try:
            await asyncio.wait_for(
                db.rollback(), timeout=settings.HEALTH_PROBE_TIMEOUT_SECONDS
            )
        except Exception:
            logger.exception("Health probe could not roll back the failed session")
        return DependencyHealth(status=_PROBE_UNAVAILABLE, error=type(exc).__name__)

    return DependencyHealth(status=_PROBE_OK)


async def _probe_redis() -> DependencyHealth:
    """PING the Redis instance the rate limiter and the realtime bus already share."""
    try:
        await asyncio.wait_for(
            get_redis().ping(),
            timeout=settings.HEALTH_PROBE_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # Same reasoning as _probe_database.
        logger.exception("Health probe failed: Redis unreachable")
        return DependencyHealth(status=_PROBE_UNAVAILABLE, error=type(exc).__name__)

    return DependencyHealth(status=_PROBE_OK)


@app.get("/health", tags=["system"], response_model=HealthResponse)
async def health_check(
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> HealthResponse:
    """Report whether this instance can actually reach Postgres and Redis.

    The probes run concurrently, so a degraded answer costs one timeout rather than two
    and the endpoint's worst case stays inside HEALTH_PROBE_TIMEOUT_SECONDS.

    Answers 503 when either dependency is unreachable. The body carries the same verdict,
    but the status code is what an orchestrator, a load balancer or an uptime monitor
    reads without being taught this response shape — a degraded instance answering 200
    would keep being handed traffic it cannot serve.
    """
    database, redis = await asyncio.gather(_probe_database(db), _probe_redis())

    checks = {_CHECK_DATABASE: database, _CHECK_REDIS: redis}
    degraded = any(check.status != _PROBE_OK for check in checks.values())

    response.status_code = (
        http_status.HTTP_503_SERVICE_UNAVAILABLE
        if degraded
        else http_status.HTTP_200_OK
    )

    return HealthResponse(
        status=_STATUS_DEGRADED if degraded else _STATUS_OK,
        environment=settings.ENVIRONMENT,
        version=settings.VERSION,
        checks=checks,
    )