"""Dev-only rig scenarios and the on-road tracker check.

Separate from dev_pulsit.py because that file's rule is "writes Pulsit mock state and
nothing else" (tests/unit/test_dev_pulsit_writes_nothing.py). These routes stage mock
state AND then run the real road check, which records exceptions through
evidence.road_check — the same function a scheduler would call. The row a reviewer sees
was written by the check reading the trackers, never by this endpoint.

Registered under the same two guards as move-truck (dev_pulsit.move_truck_enabled).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Trip
from app.db.session import get_db
from app.integrations.pulsit import MockPulsitClient, get_pulsit_client
from app.dev.services import rig as dev_rig_service
from app.orchestration.evidence import road_check
from app.dev.services.truck import TargetGeometryUnavailableError
from app.dev.schemas import (
    RigReadingRead,
    RigScenarioRequest,
    RigScenarioResponse,
    RoadCheckRequest,
    RoadCheckResponse,
    RoadFindingRead,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/dev/tracker", tags=["dev-triggers"])

_MOCK_REQUIRED_DETAIL = "Rig scenarios require the Pulsit mock — check PULSE_USE_MOCK."


async def _load_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {trip_id} not found.")
    return trip


def _to_response(trip_id: uuid.UUID, result: road_check.RoadCheckResult) -> RoadCheckResponse:
    return RoadCheckResponse(
        trip_id=trip_id,
        readings=[
            RigReadingRead(
                vehicle_id=r.vehicle_id, registration=r.registration, role=r.role.value,
                status=r.status.value, latitude=r.lat, longitude=r.lng,
            )
            for r in result.readings
        ],
        findings=[
            RoadFindingRead(
                exception_type=f.exception_type, severity=f.severity.value, vehicle_id=f.vehicle_id,
                description=f.description, newly_recorded=newly,
            )
            for newly, group in ((True, result.recorded), (False, result.already_recorded))
            for f in group
        ],
        skipped_reason=result.skipped_reason,
    )


@router.post("/scenario", response_model=RigScenarioResponse, summary="Stage a rig scenario, then run the road check")
async def run_rig_scenario(
    body: RigScenarioRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> RigScenarioResponse:
    trip = await _load_trip(db, trip_id=body.trip_id, organization_id=current_user.organization_id)
    client = get_pulsit_client(organization_id=current_user.organization_id)
    if not isinstance(client, MockPulsitClient):
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL)
    try:
        label = await dev_rig_service.stage_rig_scenario(
            db, client=client, trip=trip, scenario=body.scenario,
            trip_stop_id=body.trip_stop_id, vehicle_id=body.vehicle_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (dev_rig_service.ScenarioNotApplicableError, TargetGeometryUnavailableError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    result = await road_check.check_trip_on_road(db, trip=trip)
    base = _to_response(trip.id, result)
    return RigScenarioResponse(**base.model_dump(), scenario=body.scenario, label=label)


@router.post("/check", response_model=RoadCheckResponse, summary="Run the on-road tracker check")
async def run_road_check(
    body: RoadCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> RoadCheckResponse:
    trip = await _load_trip(db, trip_id=body.trip_id, organization_id=current_user.organization_id)
    result = await road_check.check_trip_on_road(db, trip=trip)
    return _to_response(trip.id, result)
