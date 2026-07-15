"""Service functions for resource endpoints (precincts and trips).

Layering: imports db/, schemas/, core/exceptions, integrations/ only.
Never import from api/ or auth/.

Driver and vehicle service functions have been extracted to:
  - orchestration/driver_service.py
  - orchestration/vehicle_service.py
"""

import uuid
from collections import defaultdict

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType, TripStatus
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.organisations import PrecinctRead
from app.schemas.people import DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import TripDetailResponse, TripListItemResponse
from app.schemas.vehicles import VehicleRead


async def list_precincts(db: AsyncSession, organization_id: uuid.UUID) -> list[PrecinctRead]:
    """Return precincts owned by organization_id, plus any precinct marked is_shared.

    Precincts default to private to their principal_organization_id — a precinct
    is only visible to other orgs' dispatchers if explicitly opted in via is_shared.
    """
    result = await db.execute(
        select(Precinct)
        .where(
            (Precinct.principal_organization_id == organization_id)
            | (Precinct.is_shared.is_(True))
        )
        .order_by(Precinct.name)
    )
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
    # Filter by org at the DB level — avoids leaking trip existence to other orgs.
    result = await db.execute(
        select(Trip).where(
            Trip.id == trip_id,
            Trip.operator_organization_id == operator_organization_id,
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
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

    # H2/H5 anchor a HANDSHAKE_EVENT-subject receipt (not a TRIP-subject one —
    # see handshake_service.py advance_h2/advance_h5), so a TRIP-only filter here
    # silently hid every driver-anchored pickup/delivery receipt from the
    # dispatcher's per-trip evidence view. Reuse the handshake ids already
    # fetched above (no extra query) and OR in their receipts alongside the
    # trip's own — additive only, TRIP-subject behaviour is unchanged.
    handshake_event_ids = [h.id for h in handshakes]
    receipts_result = await db.execute(
        select(BlockchainReceipt)
        .where(
            or_(
                and_(
                    BlockchainReceipt.subject_type == SubjectType.TRIP,
                    BlockchainReceipt.subject_id == trip_id,
                ),
                and_(
                    BlockchainReceipt.subject_type == SubjectType.HANDSHAKE_EVENT,
                    BlockchainReceipt.subject_id.in_(handshake_event_ids),
                ),
            )
        )
        .order_by(BlockchainReceipt.created_at, BlockchainReceipt.id)
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
