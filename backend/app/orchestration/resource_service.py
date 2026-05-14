"""Service functions for resource endpoints (drivers, vehicles, trips, precincts).

Layering: imports db/, schemas/, core/exceptions only.
Never import from api/ or auth/.
"""

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.enums import IdvsStatus, TripStatus
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.organisations import PrecinctRead
from app.schemas.people import DriverCreateBody, DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import TripDetailResponse, TripListItemResponse
from app.schemas.vehicles import VehicleCreateBody, VehicleRead


async def list_drivers(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[DriverRead]:
    result = await db.execute(
        select(Driver)
        .where(Driver.organization_id == organization_id, Driver.is_active.is_(True))
        .order_by(Driver.full_name)
    )
    return [DriverRead.model_validate(d) for d in result.scalars().all()]


async def create_driver(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: DriverCreateBody,
) -> DriverRead:
    driver = Driver(
        organization_id=organization_id,
        full_name=data.full_name,
        id_number=data.id_number,
        phone_number=data.phone_number,
        license_number=data.license_number,
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise DuplicateResourceError("Driver", "id_number", data.id_number) from exc
    await db.refresh(driver)
    return DriverRead.model_validate(driver)


async def list_vehicles(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[VehicleRead]:
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.organization_id == organization_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.registration)
    )
    return [VehicleRead.model_validate(v) for v in result.scalars().all()]


async def create_vehicle(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: VehicleCreateBody,
) -> VehicleRead:
    vehicle = Vehicle(
        organization_id=organization_id,
        registration=data.registration,
        vehicle_type=data.vehicle_type,
        pulsit_device_id=data.pulsit_device_id,
    )
    db.add(vehicle)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc
    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)


async def list_precincts(db: AsyncSession) -> list[PrecinctRead]:
    result = await db.execute(select(Precinct).order_by(Precinct.name))
    return [PrecinctRead.model_validate(p) for p in result.scalars().all()]


async def list_trips(
    db: AsyncSession,
    operator_organization_id: uuid.UUID,
    status_filter: list[TripStatus] | None = None,
) -> list[TripListItemResponse]:
    q = select(Trip).where(Trip.operator_organization_id == operator_organization_id)
    if status_filter:
        q = q.where(Trip.status.in_(status_filter))
    q = q.order_by(Trip.created_at.desc())

    trips_result = await db.execute(q)
    trips = trips_result.scalars().all()
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    # Batch-fetch to avoid N+1 queries on list views.
    driver_ids = list({t.driver_id for t in trips})
    drivers_result = await db.execute(select(Driver).where(Driver.id.in_(driver_ids)))
    drivers_by_id: dict[uuid.UUID, Driver] = {d.id: d for d in drivers_result.scalars().all()}

    horse_ids = list({t.horse_id for t in trips})
    horses_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(horse_ids)))
    horses_by_id: dict[uuid.UUID, Vehicle] = {v.id: v for v in horses_result.scalars().all()}

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids))
    )
    trip_trailers = tt_result.scalars().all()

    trailer_vehicle_ids = list({tt.trailer_id for tt in trip_trailers})
    trailers_result = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(trailer_vehicle_ids))
    )
    trailers_by_id: dict[uuid.UUID, Vehicle] = {
        v.id: v for v in trailers_result.scalars().all()
    }

    trailers_by_trip: dict[uuid.UUID, list[Vehicle]] = defaultdict(list)
    for tt in trip_trailers:
        if tt.trailer_id in trailers_by_id:
            trailers_by_trip[tt.trip_id].append(trailers_by_id[tt.trailer_id])

    exc_result = await db.execute(
        select(TripException.trip_id, func.count(TripException.id))
        .where(
            TripException.trip_id.in_(trip_ids),
            TripException.resolved.is_(False),
        )
        .group_by(TripException.trip_id)
    )
    exc_counts: dict[uuid.UUID, int] = {row[0]: row[1] for row in exc_result.all()}

    return [
        TripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            order_number=t.order_number,
            status=t.status,
            driver=DriverRead.model_validate(drivers_by_id[t.driver_id]),
            horse=VehicleRead.model_validate(horses_by_id[t.horse_id]),
            trailers=[VehicleRead.model_validate(v) for v in trailers_by_trip.get(t.id, [])],
            origin_precinct_id=t.origin_precinct_id,
            destination_precinct_id=t.destination_precinct_id,
            planned_departure_at=t.planned_departure_at,
            actual_departure_at=t.actual_departure_at,
            planned_arrival_at=t.planned_arrival_at,
            actual_arrival_at=t.actual_arrival_at,
            open_exception_count=exc_counts.get(t.id, 0),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in trips
    ]


async def get_trip_detail(
    db: AsyncSession,
    trip_id: uuid.UUID,
    operator_organization_id: uuid.UUID,
) -> TripDetailResponse:
    """Raises ResourceNotFoundError if trip not found or belongs to a different org."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None or trip.operator_organization_id != operator_organization_id:
        raise ResourceNotFoundError("Trip", str(trip_id))

    driver_result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    driver = driver_result.scalar_one()

    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id == trip_id)
    )
    trip_trailers = tt_result.scalars().all()
    trailer_ids = [tt.trailer_id for tt in trip_trailers]
    trailers_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(trailer_ids)))
    trailers_by_id = {v.id: v for v in trailers_result.scalars().all()}
    trailers = [trailers_by_id[tid] for tid in trailer_ids if tid in trailers_by_id]

    hs_result = await db.execute(
        select(HandshakeEvent)
        .where(HandshakeEvent.trip_id == trip_id)
        .order_by(HandshakeEvent.sequence_number)
    )
    handshakes = hs_result.scalars().all()

    exc_result = await db.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    exceptions = exc_result.scalars().all()

    return TripDetailResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        order_number=trip.order_number,
        status=trip.status,
        journey_lock_hash=trip.journey_lock_hash,
        idvs_check_status=trip.idvs_check_status,
        driver=DriverRead.model_validate(driver),
        horse=VehicleRead.model_validate(horse),
        trailers=[VehicleRead.model_validate(v) for v in trailers],
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        pulsit_trip_reference_id=trip.pulsit_trip_reference_id,
        planned_departure_at=trip.planned_departure_at,
        actual_departure_at=trip.actual_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        actual_arrival_at=trip.actual_arrival_at,
        closed_at=trip.closed_at,
        handshakes=[HandshakeEventRead.model_validate(h) for h in handshakes],
        exceptions=[TripExceptionRead.model_validate(e) for e in exceptions],
        blockchain_receipts=[],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )
