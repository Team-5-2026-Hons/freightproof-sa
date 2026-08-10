# FreightProof SA — FastAPI application entry point
# This is the root of the backend. All routers will be registered here
# as the API is built out. CORS is configured here for frontend access.

import logging

from fastapi import FastAPI, Request
from fastapi import status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from app.core.config import settings
from app.core.rate_limit import RateLimitMiddleware
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
    version="0.1.0",
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

# Dev trigger panel. Registered only when BOTH DEV_PANEL_ENABLED is set and the
# environment is not production — see dev_triggers.dev_panel_enabled(). These
# endpoints can fabricate scans and exceptions, so on an evidence platform they
# must be structurally absent, not merely guarded, in a production deployment.
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


class HealthResponse(BaseModel):
    status: str
    environment: str
    version: str


@app.get("/health", tags=["system"], response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        environment=settings.ENVIRONMENT,
        version="0.1.0",
    )