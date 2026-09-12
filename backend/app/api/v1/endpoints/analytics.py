"""FastAPI router for the dispatcher analytics screen (FP-156).

GET /analytics/drivers           per-driver trends over a month range
GET /analytics/vehicles          per-vehicle (horse and trailer) numbers over a month range
GET /analytics/vehicles/streaks  whole-history streaks + trips since last incident (no range)
GET /analytics/lanes             origin -> destination lanes over a month range
GET /analytics/facilities        Pulsit corroboration per precinct over a month range

Read-only, so any dispatcher may call these (get_current_dispatcher), not only admins.
The organisation always comes from the token, never from the request. Figures count
closed trips only, and are only as fresh as the last materialized-view refresh.

start_month and end_month are inclusive first-of-month dates. FastAPI's own validation
rejects a value that is not a date. _require_valid_month_range rejects the rest (a
mid-month date, or start after end) as a 422. main.py has no handler that would do this,
so a ValueError left unhandled would reach the catch-all and become a 500.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.analytics_service import (
    check_month_range,
    list_driver_analytics,
    list_facility_analytics,
    list_lane_analytics,
    list_vehicle_analytics,
    list_vehicle_streaks,
)
from app.schemas.analytics_api import (
    DriverMetricsResponse,
    FacilityMetricsResponse,
    LaneMetricsResponse,
    VehicleMetricsResponse,
    VehicleStreakResponse,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _require_valid_month_range(start_month: date, end_month: date) -> None:
    """Turn a month range the views cannot answer into a 422.

    Only this check sits inside the try. A ValueError from the queries or from building
    the response is a defect, and catching it here would misreport it as the caller's
    mistake — the same rule the trip-history cursor follows.
    """
    try:
        check_month_range(start_month, end_month)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc),
        ) from exc


@router.get(
    "/drivers",
    response_model=list[DriverMetricsResponse],
    summary="Per-driver closed-trip trends over an inclusive month range",
)
async def list_driver_analytics_endpoint(
    start_month: date,
    end_month: date,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DriverMetricsResponse]:
    _require_valid_month_range(start_month, end_month)
    return await list_driver_analytics(
        db,
        organization_id=current_user.organization_id,
        start_month=start_month,
        end_month=end_month,
    )


@router.get(
    "/vehicles",
    response_model=list[VehicleMetricsResponse],
    summary="Per-vehicle (horse and trailer) closed-trip numbers over an inclusive month range",
)
async def list_vehicle_analytics_endpoint(
    start_month: date,
    end_month: date,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleMetricsResponse]:
    _require_valid_month_range(start_month, end_month)
    return await list_vehicle_analytics(
        db,
        organization_id=current_user.organization_id,
        start_month=start_month,
        end_month=end_month,
    )


@router.get(
    "/vehicles/streaks",
    response_model=list[VehicleStreakResponse],
    summary="Whole-history clean-trip streaks and trips since the last incident, per vehicle",
)
async def list_vehicle_streaks_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleStreakResponse]:
    # No month range, by design: a streak is either still running or it is not.
    return await list_vehicle_streaks(db, organization_id=current_user.organization_id)


@router.get(
    "/lanes",
    response_model=list[LaneMetricsResponse],
    summary="Per-lane transit and schedule statistics over an inclusive month range",
)
async def list_lane_analytics_endpoint(
    start_month: date,
    end_month: date,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[LaneMetricsResponse]:
    _require_valid_month_range(start_month, end_month)
    return await list_lane_analytics(
        db,
        organization_id=current_user.organization_id,
        start_month=start_month,
        end_month=end_month,
    )


@router.get(
    "/facilities",
    response_model=list[FacilityMetricsResponse],
    summary="Per-precinct Pulsit corroboration over an inclusive month range",
)
async def list_facility_analytics_endpoint(
    start_month: date,
    end_month: date,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[FacilityMetricsResponse]:
    _require_valid_month_range(start_month, end_month)
    return await list_facility_analytics(
        db,
        organization_id=current_user.organization_id,
        start_month=start_month,
        end_month=end_month,
    )
