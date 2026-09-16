"""Queries behind the six headline tiles (GET /analytics/fleet/tiles, spec §5.0);
none takes a period. The two needing recent history (parcels complete, unused
vehicles) look back TILE_WINDOW_DAYS South African days, today included."""

import uuid
from collections import Counter
from collections.abc import Collection, Iterable
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.base import closed_trips, earliest_trip_date, trip_departures
from app.analytics.fleet.constants import PARCEL_SHORTFALL_TYPES, TILE_WINDOW_DAYS
from app.analytics.fleet.periods import (
    ExpiryBand,
    InstantRange,
    expiry_band,
    instant_range,
    resolve_start,
    trailing_days,
)
from app.analytics.views import ATTESTED_PHASE_STATUSES
from app.db.models.enums import (
    AnchorStatus,
    ExceptionReviewStatus,
    ExceptionSeverity,
    PhaseType,
    TripType,
)
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import LIVE_TRIP_STATUSES, Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.fleet_analytics import (
    CriticalWaiting,
    ExpiryBands,
    FleetTilesResponse,
    LicenceExpiry,
    ParcelsComplete,
    ReceiptsOwed,
    UnusedVehicle,
    UnusedVehicles,
)


def count_expiry_bands(expiries: Iterable[date | None], today: date) -> ExpiryBands:
    """Tally expiry dates into the tile's bands. Dates more than 180 days away are skipped."""
    counts = Counter(
        band for band in (expiry_band(expiry, today) for expiry in expiries) if band is not None
    )
    return ExpiryBands(
        expired=counts[ExpiryBand.EXPIRED],
        within_30_days=counts[ExpiryBand.WITHIN_30_DAYS],
        within_90_days=counts[ExpiryBand.WITHIN_90_DAYS],
        within_180_days=counts[ExpiryBand.WITHIN_180_DAYS],
        no_date=counts[ExpiryBand.NO_DATE],
    )


async def count_live_trips(db: AsyncSession, *, organization_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(Trip).where(
            Trip.operator_organization_id == organization_id,
            Trip.status.in_(LIVE_TRIP_STATUSES),
        )
    )
    return int(result.scalar_one())


async def critical_waiting(db: AsyncSession, *, organization_id: uuid.UUID) -> CriticalWaiting:
    """Critical exceptions still in the review queue; only critical ones enter it on
    their own (exception_service.initial_review_status)."""
    result = await db.execute(
        select(func.count(TripException.id), func.min(TripException.created_at))
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            TripException.severity == ExceptionSeverity.CRITICAL,
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
    )
    count, oldest = result.one()
    return CriticalWaiting(count=count, oldest_created_at=oldest)


async def parcels_complete(
    db: AsyncSession, *, organization_id: uuid.UUID, window: InstantRange,
) -> ParcelsComplete:
    """Loaded closed trips that departed in the window, and those with no count
    mismatch. Empty runs are excluded, since they'd flatter the rate by default."""
    trips = closed_trips(organization_id, window)
    shortfall = (
        select(TripException.id)
        .where(
            TripException.trip_id == trips.c.trip_id,
            TripException.exception_type.in_(PARCEL_SHORTFALL_TYPES),
        )
        .exists()
    )
    per_trip = (
        select(shortfall.label("has_shortfall"))
        .select_from(trips)
        .where(trips.c.trip_type == TripType.LOADED)
        .subquery()
    )
    result = await db.execute(
        select(func.count(), func.count().filter(per_trip.c.has_shortfall.is_(False)))
        .select_from(per_trip)
    )
    loaded, complete = result.one()
    return ParcelsComplete(
        window_days=TILE_WINDOW_DAYS, loaded_trip_count=loaded, complete_trip_count=complete,
    )


async def receipts_owed(
    db: AsyncSession, *, organization_id: uuid.UUID, anchored_phases: Collection[PhaseType],
) -> ReceiptsOwed:
    """Attested anchored steps whose receipt is pending or failed; excludes plan
    steps not yet reached and overridden steps, which are never anchored."""
    result = await db.execute(
        select(
            func.count().filter(PhaseEvent.anchor_status == AnchorStatus.PENDING),
            func.count().filter(PhaseEvent.anchor_status == AnchorStatus.FAILED),
        )
        .select_from(PhaseEvent)
        .join(Trip, Trip.id == PhaseEvent.trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            PhaseEvent.phase_type.in_(anchored_phases),
            PhaseEvent.status.in_(ATTESTED_PHASE_STATUSES),
        )
    )
    pending, failed = result.one()
    return ReceiptsOwed(pending_count=pending, failed_count=failed)


async def licence_expiry(
    db: AsyncSession, *, organization_id: uuid.UUID, today: date,
) -> LicenceExpiry:
    """Expiry bands for active drivers' licences and active vehicles' licence
    discs, banded in Python so the edges are the ones unit-tested in periods.expiry_band."""
    drivers = await db.execute(
        select(Driver.license_expiry).where(
            Driver.organization_id == organization_id, Driver.is_active.is_(True),
        )
    )
    discs = await db.execute(
        select(Vehicle.licence_disc_expiry).where(
            Vehicle.organization_id == organization_id, Vehicle.is_active.is_(True),
        )
    )
    return LicenceExpiry(
        drivers=count_expiry_bands(drivers.scalars().all(), today),
        vehicle_discs=count_expiry_bands(discs.scalars().all(), today),
    )


async def unused_vehicles(
    db: AsyncSession, *, organization_id: uuid.UUID, window: InstantRange,
) -> UnusedVehicles:
    """Active vehicles that neither departed in the window nor are on a live trip
    now. Any trip status counts as use — a cancelled or not-yet-departed trip still
    commits the vehicle."""
    departures = trip_departures(organization_id)
    recently_departed = select(departures.c.trip_id).where(
        departures.c.departed_at >= window.start, departures.c.departed_at < window.end,
    )
    in_use = or_(Trip.id.in_(recently_departed), Trip.status.in_(LIVE_TRIP_STATUSES))
    busy_horses = select(Trip.horse_id).where(Trip.operator_organization_id == organization_id, in_use)
    busy_trailers = (
        select(TripTrailer.trailer_id)
        .join(Trip, Trip.id == TripTrailer.trip_id)
        .where(Trip.operator_organization_id == organization_id, in_use)
    )
    result = await db.execute(
        select(Vehicle.id, Vehicle.registration, Vehicle.vehicle_type)
        .where(
            Vehicle.organization_id == organization_id,
            Vehicle.is_active.is_(True),
            Vehicle.id.not_in(busy_horses),
            Vehicle.id.not_in(busy_trailers),
        )
        .order_by(Vehicle.vehicle_type, Vehicle.registration)
    )
    return UnusedVehicles(
        window_days=TILE_WINDOW_DAYS,
        vehicles=[
            UnusedVehicle(vehicle_id=vehicle_id, registration=registration, vehicle_type=vehicle_type)
            for vehicle_id, registration, vehicle_type in result.tuples().all()
        ],
    )


async def get_fleet_tiles(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    today: date,
    anchored_phases: Collection[PhaseType],
) -> FleetTilesResponse:
    window = instant_range(*trailing_days(today, TILE_WINDOW_DAYS))
    live = await count_live_trips(db, organization_id=organization_id)
    waiting = await critical_waiting(db, organization_id=organization_id)
    parcels = await parcels_complete(db, organization_id=organization_id, window=window)
    receipts = await receipts_owed(
        db, organization_id=organization_id, anchored_phases=anchored_phases,
    )
    expiry = await licence_expiry(db, organization_id=organization_id, today=today)
    unused = await unused_vehicles(db, organization_id=organization_id, window=window)
    earliest = await earliest_trip_date(db, organization_id=organization_id)
    return FleetTilesResponse(
        live_trips=live,
        critical_waiting=waiting,
        parcels_complete=parcels,
        receipts_owed=receipts,
        licence_expiry=expiry,
        unused_vehicles=unused,
        all_time_start=resolve_start(None, end=today, earliest_activity=earliest, today=today),
    )
