"""FastAPI router for the fleet-wide Analytics page (fleet analytics spec §6).

GET /analytics/fleet/tiles      headline numbers, always "right now" (no parameters)
GET /analytics/fleet/activity   trips and cancellations over time (start?, end, grain)
GET /analytics/fleet/patterns   busy patterns by hour, weekday, date, month (start?, end)
GET /analytics/fleet/on-time    punctuality, lateness, where the time goes, plans vs reality
GET /analytics/fleet/problems   problems per 100 trips, theft signs, types, steps, risky times
GET /analytics/fleet/review     review queue: waiting now, pile over time, time to review, outcomes
GET /analytics/fleet/evidence   tracker agreement, overrides, blockchain receipts, receiver sign-off
GET /analytics/fleet/routes     busiest sites and lanes over a period (start?, end)
GET /analytics/fleet/incidents  located reports for the incident map (start?, end)

Mounted under /analytics by endpoints/analytics.py rather than registered in main.py, so the
shared main.py needs no change. Read-only, so any dispatcher may call these
(get_current_dispatcher). The organisation always comes from the token, never the request.

Periods: `end` is required and may not be after today (SAST). An omitted `start` means All
time. FastAPI's own validation rejects a malformed date or an unknown grain. _require_valid_period
rejects the rest as a 422 (spec G12).
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import Grain, Period
from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.fleet_analytics_service import (
    check_period,
    get_activity,
    get_evidence,
    get_incidents,
    get_on_time,
    get_patterns,
    get_problems,
    get_review,
    get_routes,
    get_tiles,
    resolve_period_start,
)
from app.schemas.fleet_analytics import (
    ActivityResponse,
    EvidenceResponse,
    FleetTilesResponse,
    IncidentsResponse,
    OnTimeResponse,
    PatternsResponse,
    ProblemsResponse,
    ReviewResponse,
    RoutesResponse,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/fleet", tags=["analytics"])


async def _require_valid_period(
    db: AsyncSession, *, organization_id: uuid.UUID, start: date | None, end: date, grain: Grain | None,
) -> Period:
    """Turn a period the charts cannot answer into a 422.

    Only check_period sits inside the try. A ValueError from a query or from building the
    response is a defect, and catching it here would misreport it as the caller's mistake,
    the same rule as _require_valid_month_range in endpoints/analytics.py.
    """
    first_day = await resolve_period_start(db, organization_id=organization_id, start=start, end=end)
    try:
        return check_period(start=first_day, end=end, grain=grain)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc),
        ) from exc


@router.get(
    "/tiles",
    response_model=FleetTilesResponse,
    summary="Headline fleet numbers right now: live trips, review queue, receipts, expiries",
)
async def get_fleet_tiles_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> FleetTilesResponse:
    return await get_tiles(db, organization_id=current_user.organization_id)


@router.get(
    "/activity",
    response_model=ActivityResponse,
    summary="Closed trips by departure date, and cancellations, per week/month/year",
)
async def get_fleet_activity_endpoint(
    end: date,
    grain: Grain,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ActivityResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=grain,
    )
    return await get_activity(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/patterns",
    response_model=PatternsResponse,
    summary="Average departures and arrivals per hour, weekday, date and month",
)
async def get_fleet_patterns_endpoint(
    end: date,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PatternsResponse:
    # No grain: every pattern chart covers the whole period, so there is no bar limit.
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=None,
    )
    return await get_patterns(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/on-time",
    response_model=OnTimeResponse,
    summary="On-time departures and arrivals, lateness bands, plans vs reality",
)
async def get_fleet_on_time_endpoint(
    end: date,
    grain: Grain,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> OnTimeResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=grain,
    )
    return await get_on_time(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/problems",
    response_model=ProblemsResponse,
    summary="Problems per 100 trips, theft signs, commonest types, trip steps, risky times of day",
)
async def get_fleet_problems_endpoint(
    end: date,
    grain: Grain,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ProblemsResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=grain,
    )
    return await get_problems(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/review",
    response_model=ReviewResponse,
    summary="Critical problems waiting now, queue over time, time to review, what reviews concluded",
)
async def get_fleet_review_endpoint(
    end: date,
    grain: Grain,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ReviewResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=grain,
    )
    return await get_review(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/evidence",
    response_model=EvidenceResponse,
    summary="Tracker agreement, override share, blockchain receipts and receiver QR sign-off",
)
async def get_fleet_evidence_endpoint(
    end: date,
    grain: Grain,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> EvidenceResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=grain,
    )
    return await get_evidence(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/routes",
    response_model=RoutesResponse,
    summary="Busiest sites (pickups and deliveries) and lanes (driving time, problems per trip)",
)
async def get_fleet_routes_endpoint(
    end: date,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> RoutesResponse:
    # No grain: sites and lanes are totals over the whole period.
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=None,
    )
    return await get_routes(db, organization_id=current_user.organization_id, period=period)


@router.get(
    "/incidents",
    response_model=IncidentsResponse,
    summary="Located problem reports for the incident map. Carries nothing about the driver.",
)
async def get_fleet_incidents_endpoint(
    end: date,
    start: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentsResponse:
    period = await _require_valid_period(
        db, organization_id=current_user.organization_id, start=start, end=end, grain=None,
    )
    return await get_incidents(db, organization_id=current_user.organization_id, period=period)
