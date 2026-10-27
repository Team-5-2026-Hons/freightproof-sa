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
from app.api.v1.endpoints.assistant import router as assistant_router
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

enforce_production_config(settings)

app = FastAPI(
    title="FreightProof SA",
    description="Cargo theft and disputed delivery evidence platform",
    version=settings.APP_VERSION,
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)

app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityHeadersMiddleware)

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
app.include_router(handover_public_router, prefix="/api/v1")
app.include_router(artifacts_router, prefix="/api/v1")
app.include_router(trip_artifacts_router, prefix="/api/v1")
app.include_router(exceptions_router, prefix="/api/v1")
app.include_router(exceptions_dispatcher_router, prefix="/api/v1")
app.include_router(locations_router, prefix="/api/v1")
app.include_router(checkpoints_router, prefix="/api/v1")
app.include_router(manifest_router, prefix="/api/v1")
app.include_router(parcels_router, prefix="/api/v1")
app.include_router(pp_router, prefix="/api/v1")
app.include_router(stream_router, prefix="/api/v1")
app.include_router(trip_admin_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(assistant_router, prefix="/api/v1")
app.include_router(audit_packs_router, prefix="/api/v1")
app.include_router(trip_audit_packs_router, prefix="/api/v1")
app.include_router(audit_packs_by_id_router, prefix="/api/v1")
app.include_router(incident_declarations_router, prefix="/api/v1")
app.include_router(trip_incidents_router, prefix="/api/v1")
app.include_router(incidents_router, prefix="/api/v1")
app.include_router(audit_packs_public_router, prefix="/api/v1")

if dev_panel_enabled():
    app.include_router(dev_triggers_router, prefix="/api/v1")

if move_truck_enabled():
    app.include_router(dev_pulsit_router, prefix="/api/v1")
    app.include_router(dev_tracker_router, prefix="/api/v1")
    app.include_router(dev_phone_router, prefix="/api/v1")
    configure_demo_position_provider(dev_demo_phone.staged_position)

register_realtime_hook()

register_evidence_publisher()
register_custody_publisher()


@app.exception_handler(DatabaseUnavailableError)
async def database_unavailable_handler(request: Request, exc: DatabaseUnavailableError) -> JSONResponse:
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


_DB_PROBE = text("SELECT 1")

_STATUS_OK = "ok"
_STATUS_DEGRADED = "degraded"
_PROBE_OK = "ok"
_PROBE_UNAVAILABLE = "unavailable"

_CHECK_DATABASE = "database"
_CHECK_REDIS = "redis"


class DependencyHealth(BaseModel):
    """One dependency's probe result."""

    status: Literal["ok", "unavailable"]

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
    except Exception as exc:
        logger.exception("Health probe failed: database unreachable")
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
    except Exception as exc:
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
