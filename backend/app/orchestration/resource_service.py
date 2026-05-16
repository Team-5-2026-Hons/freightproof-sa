"""Service functions for resource endpoints (drivers, vehicles, trips, precincts).

Layering: imports db/, schemas/, core/exceptions, integrations/ only.
Never import from api/ or auth/.
"""

import hashlib
import uuid
from collections import defaultdict

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.integrations.supabase_admin import create_driver_auth_user
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType, TripStatus, VehicleEventType,
)
from app.db.models.events import DriverEvent, VehicleEvent
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import DriverEventRead, VehicleEventRead
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.organisations import PrecinctRead
from app.schemas.people import DriverCreateBody, DriverDetailResponse, DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import TripDetailResponse, TripListItemResponse
from app.schemas.vehicles import VehicleCreateBody, VehicleDetailResponse, VehicleRead


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
    current_user_id: uuid.UUID,
) -> DriverRead:
    # Provision a Supabase Auth account first — drivers.id must reference
    # auth.users(id) per the FK constraint added in migration 0003.
    driver_id = await create_driver_auth_user(
        phone=data.phone_number,
        full_name=data.full_name,
    )
    driver = Driver(
        id=driver_id,
        organization_id=organization_id,
        full_name=data.full_name,
        id_number=data.id_number,
        phone_number=data.phone_number,
        license_number=data.license_number,
        license_expiry=data.license_expiry,
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise DuplicateResourceError("Driver", "id_number", data.id_number) from exc

    # POPIA: license_number is hashed before going on chain. Plaintext stays in DB only.
    license_number_sha256 = hashlib.sha256(
        driver.license_number.encode("utf-8")
    ).hexdigest()

    snapshot = {
        "license_number_sha256": license_number_sha256,
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    }
    driver_event = DriverEvent(
        id=uuid.uuid4(),
        driver_id=driver.id,
        event_type=DriverEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(driver_event)
    await db.flush()

    canonical = {
        "driver_event_id": str(driver_event.id),
        "driver_id": str(driver.id),
        "event_type": DriverEventType.CREATED.value,
        "fields": snapshot,
        "changed_by_user_id": str(current_user_id),
        "timestamp": driver_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.DRIVER_EVENT,
        subject_id=driver_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )
    driver_event.blockchain_receipt_id = receipt.id

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
    current_user_id: uuid.UUID,
) -> VehicleRead:
    vehicle = Vehicle(
        organization_id=organization_id,
        registration=data.registration,
        vehicle_type=data.vehicle_type,
        pulsit_device_id=data.pulsit_device_id,
        make=data.make,
        model=data.model,
        year=data.year,
        vin_number=data.vin_number,
        licence_disc_expiry=data.licence_disc_expiry,
        gross_vehicle_mass_kg=data.gross_vehicle_mass_kg,
    )
    db.add(vehicle)
    try:
        await db.flush()
    except IntegrityError as exc:
        if "UniqueViolationError" not in str(exc):
            raise
        raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc

    snapshot = {
        "registration": vehicle.registration,
        "vehicle_type": vehicle.vehicle_type.value if hasattr(vehicle.vehicle_type, "value") else vehicle.vehicle_type,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
        "vin_number": vehicle.vin_number,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "is_active": vehicle.is_active,
    }
    vehicle_event = VehicleEvent(
        id=uuid.uuid4(),
        vehicle_id=vehicle.id,
        event_type=VehicleEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(vehicle_event)
    await db.flush()

    canonical = {
        "vehicle_event_id": str(vehicle_event.id),
        "vehicle_id": str(vehicle.id),
        "event_type": VehicleEventType.CREATED.value,
        "fields": snapshot,
        "changed_by_user_id": str(current_user_id),
        "timestamp": vehicle_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=vehicle_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.VEHICLE_CREATED,
    )
    vehicle_event.blockchain_receipt_id = receipt.id

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

    receipts_result = await db.execute(
        select(BlockchainReceipt).where(
            BlockchainReceipt.subject_type == SubjectType.TRIP,
            BlockchainReceipt.subject_id == trip_id,
        )
    )
    receipts = receipts_result.scalars().all()

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
        blockchain_receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


async def get_vehicle_detail(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> VehicleDetailResponse:
    vehicle = (
        await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id, Vehicle.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError("Vehicle", str(vehicle_id))

    events = (
        await db.execute(
            select(VehicleEvent)
            .where(VehicleEvent.vehicle_id == vehicle_id)
            .order_by(VehicleEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt).where(
                    or_(
                        (BlockchainReceipt.subject_type == SubjectType.VEHICLE)
                        & (BlockchainReceipt.subject_id == vehicle_id),
                        (BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT)
                        & (BlockchainReceipt.subject_id.in_(event_ids)),
                    )
                )
            )
        ).scalars().all()
    else:
        receipts = []

    trips = (
        await db.execute(
            select(Trip).where(
                or_(
                    Trip.horse_id == vehicle_id,
                    Trip.id.in_(
                        select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
                    ),
                )
            ).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return VehicleDetailResponse(
        **VehicleRead.model_validate(vehicle).model_dump(),
        events=[VehicleEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )


async def get_driver_detail(
    db: AsyncSession,
    driver_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> DriverDetailResponse:
    driver = (
        await db.execute(
            select(Driver).where(
                Driver.id == driver_id, Driver.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))

    events = (
        await db.execute(
            select(DriverEvent)
            .where(DriverEvent.driver_id == driver_id)
            .order_by(DriverEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt).where(
                    (BlockchainReceipt.subject_type == SubjectType.DRIVER_EVENT)
                    & (BlockchainReceipt.subject_id.in_(event_ids))
                )
            )
        ).scalars().all()
    else:
        receipts = []

    trips = (
        await db.execute(
            select(Trip).where(Trip.driver_id == driver_id).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return DriverDetailResponse(
        **DriverRead.model_validate(driver).model_dump(),
        events=[DriverEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )
