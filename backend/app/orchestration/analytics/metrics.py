"""Service functions for the dispatcher analytics screen (FP-156).

Reads FP-153's analytics layer (app/analytics/) and adds the display names the screen
needs, so the frontend never cross-references ids against other endpoints. The metric
definitions and view SQL belong to FP-153 and are not reinterpreted here.

Layering: imports analytics/, db/, schemas/ only. Never api/ or auth/.

Every metrics read is scoped to the caller's organisation by FP-153's own functions. The
name lookups are scoped differently, on purpose:

  DRIVERS, VEHICLES — filtered by organization_id. Both belong to the operator, so a name
                      outside the caller's org is never revealed, even if a trip row
                      points at one.
  PRECINCTS         — looked up by id ONLY. A precinct belongs to the CLIENT organisation
                      (principal_organization_id), so an operator-org filter would name
                      almost no depot. The ids come from lane and facility rows already
                      limited to this operator's own closed trips, so naming them reveals
                      only places the operator's trucks have been. The is_shared rule is
                      not applied either: a precinct later made private would otherwise
                      lose its name from historical analytics.
"""

import uuid
from collections.abc import Collection, Mapping, Sequence
from datetime import date
from typing import NamedTuple, TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.driver_metrics import get_driver_metrics
from app.analytics.facility_metrics import get_facility_metrics
from app.analytics.lane_metrics import get_lane_metrics
from app.analytics.stats import validate_month_range
from app.analytics.vehicle_metrics import (
    get_vehicle_metrics,
    get_vehicle_streaks,
    trips_since_last_incident,
)
from app.db.models.enums import VehicleType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.schemas.analytics import (
    DriverMetrics,
    FacilityMetrics,
    LaneMetrics,
    VehicleMetrics,
)
from app.schemas.analytics_api import (
    DriverMetricsResponse,
    FacilityMetricsResponse,
    LaneMetricsResponse,
    VehicleMetricsResponse,
    VehicleStreakResponse,
)

ResponseT = TypeVar("ResponseT", bound=BaseModel)


class VehicleLabel(NamedTuple):
    """What the screen shows to identify a vehicle. Horses and trailers share one table,
    so the plate alone doesn't say which kind a row is."""

    registration: str
    vehicle_type: VehicleType


def check_month_range(start_month: date, end_month: date) -> None:
    """Raise ValueError for a month range the monthly views cannot answer exactly.

    Exposed so the endpoint can reject a bad range as a 422 before any query runs, with
    only this call inside its try. A ValueError raised anywhere else is a defect and must
    surface as a 500, not be misreported as the caller's mistake.
    """
    validate_month_range(start_month, end_month)


# ── Pure assembly: result rows + looked-up names -> response rows ─────────────


def _extend(response_model: type[ResponseT], row: BaseModel, **added: object) -> ResponseT:
    """Copy `row`'s stored fields into `response_model`, plus the display fields.

    dict(row) yields stored fields only. Computed rates are properties, not data, so the
    response recomputes each one from the same counts rather than carrying a copy that
    could disagree with them.
    """
    return response_model.model_validate({**dict(row), **added})


def attach_driver_names(
    metrics: Sequence[DriverMetrics], names: Mapping[uuid.UUID, str],
) -> list[DriverMetricsResponse]:
    """Order preserved. A driver with no name found keeps its row, named None."""
    return [
        _extend(DriverMetricsResponse, row, driver_name=names.get(row.driver_id))
        for row in metrics
    ]


def attach_vehicle_registrations(
    metrics: Sequence[VehicleMetrics], labels: Mapping[uuid.UUID, VehicleLabel],
) -> list[VehicleMetricsResponse]:
    """Order preserved. A vehicle with no row found keeps its metrics row, with
    registration and vehicle_type both None."""
    responses: list[VehicleMetricsResponse] = []
    for row in metrics:
        label = labels.get(row.vehicle_id)
        responses.append(_extend(
            VehicleMetricsResponse,
            row,
            registration=label.registration if label is not None else None,
            vehicle_type=label.vehicle_type if label is not None else None,
        ))
    return responses


def attach_lane_names(
    metrics: Sequence[LaneMetrics], names: Mapping[uuid.UUID, str],
) -> list[LaneMetricsResponse]:
    """Order preserved. Each end is named independently; a missing one is None."""
    return [
        _extend(
            LaneMetricsResponse,
            row,
            origin_precinct_name=names.get(row.origin_precinct_id),
            destination_precinct_name=names.get(row.destination_precinct_id),
        )
        for row in metrics
    ]


def attach_facility_names(
    metrics: Sequence[FacilityMetrics], names: Mapping[uuid.UUID, str],
) -> list[FacilityMetricsResponse]:
    """Order preserved. A precinct with no name found keeps its row, named None."""
    return [
        _extend(FacilityMetricsResponse, row, precinct_name=names.get(row.precinct_id))
        for row in metrics
    ]


# ── Name lookups — one query per grain, however many rows ────────────────────


async def _driver_names(
    db: AsyncSession, *, organization_id: uuid.UUID, driver_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, str]:
    if not driver_ids:
        return {}
    result = await db.execute(
        select(Driver.id, Driver.full_name).where(
            Driver.organization_id == organization_id,
            Driver.id.in_(driver_ids),
        )
    )
    return dict(result.tuples().all())


async def _vehicle_registrations(
    db: AsyncSession, *, organization_id: uuid.UUID, vehicle_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, VehicleLabel]:
    if not vehicle_ids:
        return {}
    result = await db.execute(
        select(Vehicle.id, Vehicle.registration, Vehicle.vehicle_type).where(
            Vehicle.organization_id == organization_id,
            Vehicle.id.in_(vehicle_ids),
        )
    )
    # vehicle_type is a String column, so it comes back as a plain str. Converted here
    # so the label really holds the enum its annotation promises.
    return {
        vehicle_id: VehicleLabel(registration, VehicleType(vehicle_type))
        for vehicle_id, registration, vehicle_type in result.tuples().all()
    }


async def _precinct_names(
    db: AsyncSession, *, precinct_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, str]:
    """By id only — deliberately no organisation or is_shared filter (module docstring)."""
    if not precinct_ids:
        return {}
    result = await db.execute(
        select(Precinct.id, Precinct.name).where(Precinct.id.in_(precinct_ids))
    )
    return dict(result.tuples().all())


# ── One function per endpoint ────────────────────────────────────────────────


async def list_driver_analytics(
    db: AsyncSession, *, organization_id: uuid.UUID, start_month: date, end_month: date,
) -> list[DriverMetricsResponse]:
    metrics = await get_driver_metrics(
        db, organization_id=organization_id, start_month=start_month, end_month=end_month,
    )
    names = await _driver_names(
        db, organization_id=organization_id, driver_ids={row.driver_id for row in metrics},
    )
    return attach_driver_names(metrics, names)


async def list_vehicle_analytics(
    db: AsyncSession, *, organization_id: uuid.UUID, start_month: date, end_month: date,
) -> list[VehicleMetricsResponse]:
    metrics = await get_vehicle_metrics(
        db, organization_id=organization_id, start_month=start_month, end_month=end_month,
    )
    labels = await _vehicle_registrations(
        db, organization_id=organization_id, vehicle_ids={row.vehicle_id for row in metrics},
    )
    return attach_vehicle_registrations(metrics, labels)


async def list_vehicle_streaks(
    db: AsyncSession, *, organization_id: uuid.UUID,
) -> list[VehicleStreakResponse]:
    """Whole-history streaks, each carrying the vehicle's live trips-since-last-incident.

    One query per vehicle, because FP-153's trips_since_last_incident is per-vehicle and
    frozen. That is acceptable at current fleet size, and it keeps the screen at ONE HTTP
    request for the whole table. The queries run one after another: an AsyncSession can
    only run one statement at a time.
    """
    streaks = await get_vehicle_streaks(db, organization_id=organization_id)
    responses: list[VehicleStreakResponse] = []
    for streak in streaks:
        count = await trips_since_last_incident(
            db, organization_id=organization_id, vehicle_id=streak.vehicle_id,
        )
        responses.append(_extend(VehicleStreakResponse, streak, trips_since_last_incident=count))
    return responses


async def list_lane_analytics(
    db: AsyncSession, *, organization_id: uuid.UUID, start_month: date, end_month: date,
) -> list[LaneMetricsResponse]:
    metrics = await get_lane_metrics(
        db, organization_id=organization_id, start_month=start_month, end_month=end_month,
    )
    precinct_ids = {row.origin_precinct_id for row in metrics} | {
        row.destination_precinct_id for row in metrics
    }
    names = await _precinct_names(db, precinct_ids=precinct_ids)
    return attach_lane_names(metrics, names)


async def list_facility_analytics(
    db: AsyncSession, *, organization_id: uuid.UUID, start_month: date, end_month: date,
) -> list[FacilityMetricsResponse]:
    metrics = await get_facility_metrics(
        db, organization_id=organization_id, start_month=start_month, end_month=end_month,
    )
    names = await _precinct_names(db, precinct_ids={row.precinct_id for row in metrics})
    return attach_facility_names(metrics, names)
