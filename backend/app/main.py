# FreightProof SA — FastAPI application entry point
# This is the root of the backend. All routers will be registered here
# as the API is built out. CORS is configured here for frontend access.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints.drivers import router as drivers_router
from app.api.v1.endpoints.precincts import router as precincts_router
from app.api.v1.endpoints.trips import router as trips_router
from app.api.v1.endpoints.vehicles import router as vehicles_router
from app.auth.router import router as auth_router

app = FastAPI(
    title="FreightProof SA",
    description="Cargo theft and disputed delivery evidence platform",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

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


@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0",
    }