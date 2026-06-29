"""Trip orchestration — create_trip() is the single entry point for trip creation.

Layering: this module imports from db/, crypto/, and schemas/ only.
It must never import from api/ or auth/.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload
from app.db.models.enums import BlockchainReceiptType, HandshakeStatus, HandshakeType, IdvsStatus, SubjectType, TripStatus, VehicleType
from app.db.models.handshakes import HandshakeEvent
from app.db.models.people import Driver
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.resource_service import get_trip_detail
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.people import DriverRead, UserRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse
from app.schemas.vehicles import VehicleRead


def _generate_trip_reference() -> str:
    """Return a unique trip reference in the format FP-YYYYMMDD-XXXXXXXX."""
    date_str = datetime.now(UTC).strftime("%Y%m%d")
    short_id = uuid.uuid4().hex[:8].upper()
    return f"FP-{date_str}-{short_id}"


async def _fetch_driver(
    db: AsyncSession,
    driver_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> Driver:
    result = await db.execute(
        select(Driver).where(
            Driver.id == driver_id,
            Driver.organization_id == organization_id,
            Driver.is_active.is_(True),
        )
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))
    return driver


async def _fetch_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    vehicle_type: VehicleType,
    organization_id: uuid.UUID,
) -> Vehicle:
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.organization_id == organization_id,
            Vehicle.is_active.is_(True),
            Vehicle.vehicle_type == vehicle_type,
        )
    )
    vehicle = result.scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError(vehicle_type.value.capitalize(), str(vehicle_id))
    return vehicle


async def _check_order_number_conflict(
    db: AsyncSession,
    order_number: str,
    operator_org_id: uuid.UUID,
) -> None:
    """Raise TripConflictError if an active trip already has this order_number."""
    active_statuses = [
        TripStatus.CREATED,
        TripStatus.ORIGIN_GATE_IN,
        TripStatus.LOADING,
        TripStatus.ORIGIN_GATE_OUT,
        TripStatus.IN_TRANSIT,
        TripStatus.DEST_GATE_IN,
        TripStatus.UNLOADING,
        TripStatus.EXCEPTION_HOLD,
    ]
    conflict_exists = await db.execute(
        select(
            exists().where(
                Trip.order_number == order_number,
                Trip.operator_organization_id == operator_org_id,
                Trip.status.in_(active_statuses),
            )
        )
    )
    if conflict_exists.scalar():
        raise TripConflictError(order_number)


async def create_trip(
    db: AsyncSession,
    payload: TripCreateRequest,
    current_user: UserRead,
) -> TripDetailResponse:
    """Create a Trip, TripTrailer rows, and the H0 HandshakeEvent atomically.

    Raises:
        ResourceNotFoundError: if driver, horse, or any trailer is not found/inactive.
        TripConflictError: if an active trip already exists for the given order_number.
    """
    # 1. Validate all referenced records exist before any writes.
    driver = await _fetch_driver(
        db,
        payload.driver_id,
        current_user.organization_id,
    )
    horse = await _fetch_vehicle(
        db,
        payload.horse_id,
        VehicleType.HORSE,
        current_user.organization_id,
    )
    trailers: list[Vehicle] = []
    for trailer_id in payload.trailer_ids:
        trailers.append(
            await _fetch_vehicle(
                db,
                trailer_id,
                VehicleType.TRAILER,
                current_user.organization_id,
            )
        )

    # 2. Guard against duplicate active order_number within this operator org.
    await _check_order_number_conflict(
        db, payload.order_number, current_user.organization_id
    )

    # 3. Create the Trip row.
    trip_id = uuid.uuid4()
    trip = Trip(
        id=trip_id,
        trip_reference=_generate_trip_reference(),
        order_number=payload.order_number,
        operator_organization_id=current_user.organization_id,
        client_organization_id=payload.client_organization_id,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        origin_precinct_id=payload.origin_precinct_id,
        destination_precinct_id=payload.destination_precinct_id,
        template_id=payload.template_id,
        planned_departure_at=payload.planned_departure_at,
        planned_arrival_at=payload.planned_arrival_at,
        status=TripStatus.CREATED,
        idvs_check_status=IdvsStatus.PENDING,
        created_by_user_id=current_user.id,
    )
    db.add(trip)

    # 4. Create TripTrailer rows — snapshot the Pulsit device ID at creation time
    #    so retroactive vehicle reassignment cannot alter the evidence chain.
    for vehicle in trailers:
        db.add(
            TripTrailer(
                trip_id=trip_id,
                trailer_id=vehicle.id,
                pulsit_device_id_snapshot=vehicle.pulsit_device_id,
            )
        )

    # Flush trip + trailers before adding the HandshakeEvent. The evidence_artifacts
    # table has a use_alter=True FK back to trips, creating a circular dependency
    # in SQLAlchemy's unit-of-work topological sort. Without an explicit flush here,
    # the sort can emit the HandshakeEvent INSERT before trips, violating the FK.
    await db.flush()

    # 5. Create the H0 HandshakeEvent (Trip Creation handshake).
    h0 = HandshakeEvent(
        trip_id=trip_id,
        handshake_type=HandshakeType.TRIP_CREATION,
        sequence_number=0,
        status=HandshakeStatus.PENDING,
    )
    db.add(h0)
    await db.flush()

    # 6. Compute journey lock hash over the immutable trip parameters.
    lock_hash = compute_journey_lock_hash(
        trip_id=trip_id,
        order_number=payload.order_number,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        trailer_ids=payload.trailer_ids,
        origin_precinct_id=payload.origin_precinct_id,
        destination_precinct_id=payload.destination_precinct_id,
        created_by_user_id=current_user.id,
        created_at=trip.created_at,
    )
    canonical = compute_trip_canonical_payload(
        trip_id=trip_id,
        order_number=payload.order_number,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        trailer_ids=payload.trailer_ids,
        origin_precinct_id=payload.origin_precinct_id,
        destination_precinct_id=payload.destination_precinct_id,
        created_by_user_id=current_user.id,
        created_at=trip.created_at,
    )
    trip.journey_lock_hash = lock_hash

    # Anchor synchronously to Hedera HCS (blocks ~4-6s for demo).
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.TRIP,
        subject_id=trip_id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.JOURNEY_LOCK,
        trip_id=trip_id,
    )

    await db.flush()
    await db.refresh(trip)
    await db.refresh(h0)
    await db.refresh(receipt)

    # 7. Assemble and return the response (no ORM relationships — fetch separately).
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
        handshakes=[HandshakeEventRead.model_validate(h0)],
        exceptions=[],
        blockchain_receipts=[BlockchainReceiptRead.model_validate(receipt)],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


async def get_active_trip_for_driver(db: AsyncSession, driver_id: uuid.UUID) -> TripDetailResponse | None:
    """Return the driver's one active trip, or None. 'Active' excludes closed/cancelled."""
    inactive = {TripStatus.CLOSED, TripStatus.CANCELLED}
    result = await db.execute(
        select(Trip).where(Trip.driver_id == driver_id, Trip.status.notin_(inactive))
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        return None
    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
