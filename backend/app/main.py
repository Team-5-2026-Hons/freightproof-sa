# FreightProof SA — FastAPI application entry point. All routers are
# registered here; CORS is configured here for frontend access.

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
from app.api.v1.endpoints.analytics import router as analytics_router
from app.api.v1.endpoints.artifacts import router as artifacts_router
from app.api.v1.endpoints.artifacts import trip_artifacts_router
from app.api.v1.endpoints.audit_packs import declarations_router as incident_declarations_router
from app.api.v1.endpoints.audit_packs import packs_router as audit_packs_by_id_router
from app.api.v1.endpoints.audit_packs import router as audit_packs_router
from app.api.v1.endpoints.audit_packs import trip_packs_router as trip_audit_packs_router
from app.api.v1.endpoints.audit_packs_public import router as audit_packs_public_router
from app.api.v1.endpoints.blockchain import router as blockchain_router
from app.api.v1.endpoints.checkpoints import router as checkpoints_router
from app.dev.endpoints.pulsit import move_truck_enabled
from app.dev.endpoints.pulsit import router as dev_pulsit_router
from app.dev.endpoints.tracker import router as dev_tracker_router
from app.dev.endpoints.phone import router as dev_phone_router
from app.dev.endpoints.triggers import dev_panel_enabled
from app.dev.endpoints.triggers import router as dev_triggers_router
from app.dev.services import demo_phone as dev_demo_phone
from app.orchestration.phases.demo_position import configure_demo_position_provider
from app.api.v1.endpoints.drivers import router as drivers_router
from app.api.v1.endpoints.exceptions import dispatcher_router as exceptions_dispatcher_router
from app.api.v1.endpoints.exceptions import router as exceptions_router
from app.api.v1.endpoints.locations import router as locations_router
from app.api.v1.endpoints.manifest import router as manifest_router
from app.api.v1.endpoints.parcels import router as parcels_router
from app.api.v1.endpoints.handover import public_router as handover_public_router
from app.api.v1.endpoints.incidents import router as incidents_router
from app.api.v1.endpoints.incidents import trip_incidents_router
from app.api.v1.endpoints.handover import router as handover_router
from app.api.v1.endpoints.phases import router as phases_router
from app.api.v1.endpoints.pp import router as pp_router
from app.api.v1.endpoints.precincts import router as precincts_router
from app.api.v1.endpoints.stream import router as stream_router
from app.api.v1.endpoints.trip_admin import router as trip_admin_router
from app.api.v1.endpoints.driver_substitutions import (
    dispatcher_router as driver_substitutions_dispatcher_router,
    driver_router as driver_substitutions_driver_router,
    late_evidence_router as driver_substitutions_late_evidence_router,
)
from app.api.v1.endpoints.trips import router as trips_router
from app.api.v1.endpoints.vehicles import router as vehicles_router
from app.auth.router import router as auth_router
from app.core.config_validation import enforce_production_config
from app.core.realtime import register_realtime_hook
from app.db.errors import DATABASE_UNAVAILABLE_DETAIL, DatabaseUnavailableError
from app.db.session import get_read_only_db
from app.tasks.driver_substitutions import register_custody_publisher
from app.tasks.evidence_anchors import register_evidence_publisher

logger = logging.getLogger(__name__)

_IS_PRODUCTION = settings.ENVIRONMENT == "production"

# Before anything is built — catches misconfiguration that would otherwise
# fail silently in production (see core/config_validation.py).
enforce_production_config(settings)

# docs/openapi are a map of the attack surface; useful in dev, gratuitous in
# prod. Passed as None to remove the routes entirely rather than guard them.
app = FastAPI(
    title="FreightProof SA",
    description="Cargo theft and disputed delivery evidence platform",
    version=settings.APP_VERSION,
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)

# Rate limiting, applied to every request before routing (catches floods
# aimed at nonexistent paths too).
#
# Order note: Starlette's add_middleware inserts at the FRONT of the stack,
# so the middleware added last ends up outermost. CORS is added after this
# and wraps it, so a 429 still carries CORS headers on the way out — a
# throttled browser sees a readable rate-limit response, not an opaque
# network failure.
app.add_middleware(RateLimitMiddleware)

# Configured here, not per-router, so all endpoints share one origin policy.
# cors_allowed_origins, not ALLOWED_ORIGINS directly: that property folds in
# the receiver app's origin so a .env override can't drop it — see its docstring.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last so it's outermost of all three — a rate-limiter 429 or CORS
# rejection still gets these headers too.
app.add_middleware(SecurityHeadersMiddleware)

# FP-83: the driver's /trips/me/... substitution routes go BEFORE the trips router, whose
# /trips/me/{trip_id} would otherwise consume /trips/me/driver-substitutions as a trip id.
app.include_router(driver_substitutions_driver_router, prefix="/api/v1")
app.include_router(trips_router, prefix="/api/v1")
app.include_router(driver_substitutions_dispatcher_router, prefix="/api/v1")
app.include_router(driver_substitutions_late_evidence_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(drivers_router, prefix="/api/v1")
app.include_router(vehicles_router, prefix="/api/v1")
app.include_router(precincts_router, prefix="/api/v1")
app.include_router(blockchain_router, prefix="/api/v1")
app.include_router(phases_router, prefix="/api/v1")
app.include_router(handover_router, prefix="/api/v1")
# Unauthenticated by design (FP-239) — the capability token in the path is
# the whole authorisation. See endpoints/handover.py.
app.include_router(handover_public_router, prefix="/api/v1")
app.include_router(artifacts_router, prefix="/api/v1")
app.include_router(trip_artifacts_router, prefix="/api/v1")
app.include_router(exceptions_router, prefix="/api/v1")
# Org-scoped sibling: the dispatcher's exception queue spans every trip in
# the org, so it can't live under the trip-nested prefix.
app.include_router(exceptions_dispatcher_router, prefix="/api/v1")
app.include_router(locations_router, prefix="/api/v1")
app.include_router(checkpoints_router, prefix="/api/v1")
app.include_router(manifest_router, prefix="/api/v1")
app.include_router(parcels_router, prefix="/api/v1")
app.include_router(pp_router, prefix="/api/v1")
app.include_router(stream_router, prefix="/api/v1")
app.include_router(trip_admin_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(audit_packs_router, prefix="/api/v1")
app.include_router(trip_audit_packs_router, prefix="/api/v1")
app.include_router(audit_packs_by_id_router, prefix="/api/v1")
app.include_router(incident_declarations_router, prefix="/api/v1")
app.include_router(trip_incidents_router, prefix="/api/v1")
app.include_router(incidents_router, prefix="/api/v1")
app.include_router(audit_packs_public_router, prefix="/api/v1")

# Dev trigger panel. Gated on DEV_PANEL_ENABLED only, not _IS_PRODUCTION —
# the deployed demo runs ENVIRONMENT="production" and still needs this panel.
# These endpoints fabricate scans/exceptions; when the flag is off the
# router is never registered, so the paths simply don't exist. See
# dev_triggers.dev_panel_enabled().
if dev_panel_enabled():
    app.include_router(dev_triggers_router, prefix="/api/v1")

# FP-116 "move the truck" — stricter guard (DEV_PANEL_ENABLED AND
# PULSE_USE_MOCK) since staging a position while pointed at live Pulsit
# would write into a mock nothing reads. See dev_pulsit.move_truck_enabled().
if move_truck_enabled():
    app.include_router(dev_pulsit_router, prefix="/api/v1")
    # Same two guards: rig scenarios stage the Pulsit mock too. See dev_tracker.py.
    app.include_router(dev_tracker_router, prefix="/api/v1")
    # "Move the phone" — the driver-side counterpart, a separate control from the truck.
    app.include_router(dev_phone_router, prefix="/api/v1")
    # "Move the phone", the driver-side counterpart. Installing the provider HERE, behind
    # the same guard as the routes that stage a position, is what keeps the phase paths
    # free of any import of app/dev — and what guarantees a deployment without these
    # flags has no provider at all, so no phase can read a staged position. See
    # orchestration/phases/demo_position.py.
    configure_demo_position_provider(dev_demo_phone.staged_position)

# Publishes queued realtime events once a request's transaction is durable
# (see app/core/realtime.py). Idempotent.
register_realtime_hook()

# Lets the request path queue evidence-anchor events on the Celery worker without importing
# the task layer (see orchestration/evidence_anchors/dispatch.py). Idempotent.
register_evidence_publisher()
# The same for FP-83 custody anchors (orchestration/substitutions/anchors.py).
register_custody_publisher()


@app.exception_handler(DatabaseUnavailableError)
async def database_unavailable_handler(request: Request, exc: DatabaseUnavailableError) -> JSONResponse:
    # Route templates, never raw URLs: public handover/audit links carry secrets in
    # the path. Driver exception messages can also contain connection/SQL parameters.
    route = getattr(request.scope.get("route"), "path", "<unmatched>")
    logger.warning(
        "Database unavailable reason=%s operation=%s route=%s "
        "pool_size=%s max_overflow=%s connect_timeout=%s pool_timeout=%s command_timeout=%s cleanup_timeout=%s",
        exc.reason, exc.operation, route, settings.DB_POOL_SIZE, settings.DB_MAX_OVERFLOW,
        settings.DB_CONNECT_TIMEOUT_SECONDS, settings.DB_POOL_TIMEOUT_SECONDS,
        settings.DB_COMMAND_TIMEOUT_SECONDS, settings.DB_CLEANUP_TIMEOUT_SECONDS,
    )
    return JSONResponse(
        status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": DATABASE_UNAVAILABLE_DETAIL},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort net for anything uncaught, so a caller gets a clean JSON
    500 instead of an ASGI-server-specific bare error page, and the
    traceback is never lost.

    Registering on bare `Exception` hooks Starlette's ServerErrorMiddleware;
    `HTTPException`/`RequestValidationError` are already fully resolved by
    FastAPI's own handlers on the inner ExceptionMiddleware, so they never
    reach here (verified by test_global_handler_preserves_http_exceptions).
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )


# ── Health check ──────────────────────────────────────────────────────────────
# A 200 from process memory alone only proves the process is running — the
# outages that actually take FreightProof down leave it alive but cut off
# from Supabase or Redis, so this probes both on every call.

_DB_PROBE = text("SELECT 1")

# Named so the endpoint, models and tests can't drift apart on a typo.
_STATUS_OK = "ok"
_STATUS_DEGRADED = "degraded"
_PROBE_OK = "ok"
_PROBE_UNAVAILABLE = "unavailable"

# Probe names, also the keys of HealthResponse.checks.
_CHECK_DATABASE = "database"
_CHECK_REDIS = "redis"


class DependencyHealth(BaseModel):
    """One dependency's probe result."""

    status: Literal["ok", "unavailable"]

    # Exception CLASS name only, never its message — /health is
    # unauthenticated and a connection error's message routinely carries
    # the DSN (host, port, user).
    error: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    environment: str
    version: str
    checks: dict[str, DependencyHealth]


async def _probe_database(db: AsyncSession) -> DependencyHealth:
    """Round-trip the smallest possible query against Postgres.

    Uses the request's injected session so this exercises the same engine
    and pool the endpoints use, rather than a private connection that could
    pass while the real pool is exhausted.
    """
    try:
        await asyncio.wait_for(
            db.execute(_DB_PROBE),
            timeout=settings.HEALTH_PROBE_TIMEOUT_SECONDS,
        )
    # Broad on purpose: a health check whose failure path itself raises turns
    # a legible "degraded" into an unnamed 500. Every fault (timeout,
    # DBAPIError, a session already poisoned) is logged with its traceback,
    # never swallowed.
    except Exception as exc:
        logger.exception("Health probe failed: database unreachable")
        # invalidate() (not rollback) terminates the connection outright
        # rather than sending a polite ROLLBACK down what's likely a hung
        # socket — bounded the same way the probe above is, so this can't
        # extend the endpoint's promised response window.
        try:
            await asyncio.wait_for(
                db.invalidate(), timeout=settings.HEALTH_PROBE_TIMEOUT_SECONDS
            )
        except Exception:
            logger.exception("Health probe could not discard the failed session")
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
    db: AsyncSession = Depends(get_read_only_db),
) -> HealthResponse:
    """Report whether this instance can actually reach Postgres and Redis.

    Probes run concurrently, so a degraded answer costs one timeout, not two.
    The session is read-only so nothing commits on the way out.

    Answers 503 when either dependency is unreachable — the status code is
    what an orchestrator/load balancer reads without being taught this
    response shape, so a degraded instance doesn't keep getting traffic.
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
        version=settings.APP_VERSION,
        checks=checks,
    )
