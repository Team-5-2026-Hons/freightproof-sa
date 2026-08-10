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
from app.db.models.enums import PhaseStatus, SubjectType, TripStatus, TripType
from app.db.models.phases import PhaseEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_gate import blocked_on_by_stop
from app.orchestration.scan_service import scanned_counts_for_trip
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.phases import PhaseEventRead
from app.schemas.organisations import PrecinctRead
from app.schemas.people import DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import ConsignmentRead, TripDetailResponse, TripListItemResponse, TripStopRead
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

    # Same batching shape as exc_counts above: one grouped query for the page.
    # `completed` here means "resolved" in the ledger's sense — an overridden phase
    # will never be revisited either, so it counts as done for a progress bar.
    plan_result = await db.execute(
        select(
            PhaseEvent.trip_id,
            func.count(PhaseEvent.id),
            func.count(PhaseEvent.id).filter(
                PhaseEvent.status.in_([PhaseStatus.COMPLETED, PhaseStatus.OVERRIDDEN])
            ),
        )
        .where(PhaseEvent.trip_id.in_(trip_ids))
        .group_by(PhaseEvent.trip_id)
    )
    plan_counts: dict[uuid.UUID, tuple[int, int]] = {
        row[0]: (row[1], row[2]) for row in plan_result.all()
    }

    return [
        TripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            order_number=t.order_number,
            status=t.status,
            trip_type=TripType(t.trip_type),
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
            current_phase=t.current_phase,
            current_stop=t.current_stop,
            phase_total=plan_counts.get(t.id, (0, 0))[0],
            phase_completed=plan_counts.get(t.id, (0, 0))[1],
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
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    phase_events = hs_result.scalars().all()

    exc_result = await db.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    exceptions = exc_result.scalars().all()

    # H3/H5 anchor a PHASE_EVENT-subject receipt (not a TRIP-subject one —
    # see phase_service.py advance_departure/advance_confirmation), so a TRIP-only filter here
    # silently hid every driver-anchored pickup/delivery receipt from the
    # dispatcher's per-trip evidence view. Reuse the phase event ids already
    # fetched above (no extra query) and OR in their receipts alongside the
    # trip's own — additive only, TRIP-subject behaviour is unchanged.
    phase_event_ids = [h.id for h in phase_events]
    receipts_result = await db.execute(
        select(BlockchainReceipt)
        .where(
            or_(
                and_(
                    BlockchainReceipt.subject_type == SubjectType.TRIP,
                    BlockchainReceipt.subject_id == trip_id,
                ),
                and_(
                    BlockchainReceipt.subject_type == SubjectType.PHASE_EVENT,
                    BlockchainReceipt.subject_id.in_(phase_event_ids),
                ),
            )
        )
        .order_by(BlockchainReceipt.created_at, BlockchainReceipt.id)
    )
    receipts = receipts_result.scalars().all()

    stops_result = await db.execute(
        select(TripStop).where(TripStop.trip_id == trip_id).order_by(TripStop.sequence)
    )
    stops = stops_result.scalars().all()

    # PhaseEventRead.stop_sequence is a join, not a column — build the map from
    # the stops already fetched rather than issuing a second query.
    stop_sequence_by_id = {s.id: s.sequence for s in stops}

    # Hoisted out of the phases=[...] comprehension below: one gate query for the
    # whole trip, not one per phase event.
    gate = await blocked_on_by_stop(db, trip_id=trip_id)

    # id tiebreaker: consignments inserted in one transaction share the same
    # created_at (Postgres now() is per-transaction), so created_at alone is
    # non-deterministic across reads.
    consignments_result = await db.execute(
        select(Consignment)
        .where(Consignment.trip_id == trip_id)
        .order_by(Consignment.created_at, Consignment.id)
    )
    consignments = consignments_result.scalars().all()

    # One batched query for the whole trip's live scan progress — see its docstring
    # for why this must not become a per-consignment loop on a dispatcher poll path.
    scan_counts = await scanned_counts_for_trip(db, trip_id=trip_id)
    consignment_reads = [
        ConsignmentRead.model_validate(c).model_copy(update={
            "scanned_out_count": scan_counts[c.id].scanned_out if c.id in scan_counts else 0,
            "scanned_in_count": scan_counts[c.id].scanned_in if c.id in scan_counts else 0,
        })
        for c in consignments
    ]

    return TripDetailResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        order_number=trip.order_number,
        status=trip.status,
        trip_type=TripType(trip.trip_type),
        journey_lock_hash=trip.journey_lock_hash,
        idvs_check_status=trip.idvs_check_status,
        driver=DriverRead.model_validate(driver),
        horse=VehicleRead.model_validate(horse),
        trailers=[VehicleRead.model_validate(v) for v in trailers],
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        stops=[TripStopRead.model_validate(s) for s in stops],
        consignments=consignment_reads,
        pulsit_trip_reference_id=trip.pulsit_trip_reference_id,
        planned_departure_at=trip.planned_departure_at,
        actual_departure_at=trip.actual_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        actual_arrival_at=trip.actual_arrival_at,
        closed_at=trip.closed_at,
        current_phase=trip.current_phase,
        current_stop=trip.current_stop,
        phases=[
            PhaseEventRead.from_event(
                e, stop_sequence_by_id=stop_sequence_by_id, blocked_on_by_stop=gate,
            )
            for e in phase_events
        ],
        exceptions=[TripExceptionRead.model_validate(e) for e in exceptions],
        blockchain_receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        warnings=[],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )
