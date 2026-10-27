"""Trip orchestration — persist_trip() is the single write path for trip creation:
create_trip() (POST /trips) and consignments.manifest_import (POST /trips/from-pp-manifest)
both go through it.

Layering: this module imports from blockchain/, core/, crypto/, db/, schemas/ and other
orchestration/ modules (integrations/ for types only). It must never import from api/ or auth/.
"""

import logging
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import (
    ConsignmentAlreadyAssignedError,
    CrewUnavailableError,
    PPManifestAlreadyOnTripError,
    PPSyncError,
    ResourceNotFoundError,
)
from app.crypto.hashing import (
    PPManifestKey, StopCommitment, compute_journey_lock_hash, compute_trip_canonical_payload_v2,
)
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.cleanup import rollback_after_error
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, IdvsStatus, PhaseStatus, SubjectType, TripStatus,
    TripType, VehicleType,
)
from app.db.models.phases import PhaseEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.trips import (
    PP_MANIFEST_INDEX, Consignment, Trip, TripStop, TripTrailer,
)
from app.db.models.vehicles import Vehicle
from app.orchestration.fleet.precinct_visibility import visible_to
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.phases.plan import ANCHORED_PHASES, PlanStop, build_phase_plan
from app.orchestration.phases.state import recompute_position
from app.orchestration.trips.availability import (
    CrewFilter, TimeWindow, busy_crew_in_window, clash_message, lock_crew, planned_window,
)
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.phases import PhaseEventRead
from app.schemas.people import DriverRead, UserRead
from app.schemas.pp_manifest import PPManifestRef
from app.schemas.trips import (
    ConsignmentRead,
    TripConsignmentInput,
    TripCreateRequest,
    TripDetailResponse,
    TripStopCreate,
    TripStopRead,
    stop_slot_times,
)
from app.schemas.vehicles import VehicleRead

if TYPE_CHECKING:
    from app.integrations.parcel_perfect.models import PPWaybillResponse
    from app.orchestration.consignments.sync import ConsignmentSyncResult

logger = logging.getLogger(__name__)


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


async def _assert_precincts_visible(
    db: AsyncSession, stops: list[TripStopCreate], organization_id: uuid.UUID,
) -> None:
    """Refuses a route through a precinct this dispatcher may not see (SEC-PRECINCT-1).

    A foreign private precinct and a nonexistent id raise the same ResourceNotFoundError, so
    the response never reveals whether another organisation owns a given depot — the same
    stance _fetch_driver takes for another organisation's driver.
    """
    wanted = {spec.precinct_id for spec in stops}
    found = set((await db.execute(
        select(Precinct.id).where(Precinct.id.in_(wanted), visible_to(organization_id))
    )).scalars().all())
    for missing in sorted(wanted - found, key=str):
        raise ResourceNotFoundError("Precinct", str(missing))


async def _claim_crew(
    db: AsyncSession, new_trip: "NewTrip", organization_id: uuid.UUID,
) -> tuple[Driver, Vehicle, list[Vehicle]]:
    """Lock the crew, load it (404 for anything missing or inactive), and refuse a clash.

    The lock comes first, so two dispatchers claiming the same horse are serialised: the second
    waits for the first to commit, then sees its trip and is refused (spec D7). The check runs
    inside the same transaction as the insert that follows, so nothing can slip in between.
    """
    await lock_crew(db, driver_id=new_trip.driver_id, vehicle_ids=[new_trip.horse_id, *new_trip.trailer_ids])
    driver = await _fetch_driver(db, new_trip.driver_id, organization_id)
    horse = await _fetch_vehicle(db, new_trip.horse_id, VehicleType.HORSE, organization_id)
    trailers = [
        await _fetch_vehicle(db, trailer_id, VehicleType.TRAILER, organization_id)
        for trailer_id in new_trip.trailer_ids
    ]

    if new_trip.manifest is not None:
        winner = await find_live_trip_for_manifest(
            db, operator_organization_id=organization_id, key=new_trip.manifest.key,
        )
        if winner is not None:
            raise PPManifestAlreadyOnTripError(trip_id=winner.id, trip_reference=winner.trip_reference)

    now = datetime.now(UTC)
    start, end = planned_window(
        new_trip.planned_departure_at, new_trip.planned_arrival_at, stop_slot_times(new_trip.stops),
    )
    clashes = await busy_crew_in_window(
        db, organization_id=organization_id,
        window=TimeWindow(start=start or now, end=end), now=now,
        crew=CrewFilter(
            driver_id=new_trip.driver_id, horse_id=new_trip.horse_id, trailer_ids=tuple(new_trip.trailer_ids),
        ),
    )
    if clashes:
        raise CrewUnavailableError(
            clash_message(clashes), [entry.model_dump(mode="json") for entry in clashes],
        )
    return driver, horse, trailers


@dataclass(frozen=True)
class ManifestCargo:
    """A loaded trip's cargo exactly as the PP manifest supplied it (FP-281). Already
    fetched and validated by consignments.manifest_import; persist_trip makes no PP call for it."""

    key: PPManifestKey
    client_organization_id: uuid.UUID
    client_name: str
    waybills: "list[PPWaybillResponse]"
    snapshot: dict[str, Any]
    snapshot_sha256: str


@dataclass(frozen=True)
class NewTrip:
    """Everything persist_trip needs, from either creation endpoint."""

    driver_id: uuid.UUID
    horse_id: uuid.UUID
    trailer_ids: list[uuid.UUID]
    stops: list[TripStopCreate]
    trip_type: TripType
    planned_departure_at: datetime | None
    planned_arrival_at: datetime | None
    template_id: uuid.UUID | None = None
    consignment_refs: list[TripConsignmentInput] = field(default_factory=list)
    manifest: ManifestCargo | None = None


async def find_live_trip_for_manifest(
    db: AsyncSession, *, operator_organization_id: uuid.UUID, key: PPManifestKey,
) -> Trip | None:
    """The non-cancelled trip holding this manifest — the same rule as uq_trips_pp_manifest."""
    result = await db.execute(
        select(Trip).where(
            Trip.operator_organization_id == operator_organization_id,
            Trip.pp_manifest_issuer_account == key.issuer_account,
            Trip.pp_manifest_origin_hub == key.origin_hub,
            Trip.pp_manifest_number == key.number,
            Trip.status != TripStatus.CANCELLED,
        )
    )
    return result.scalar_one_or_none()


async def _manifest_conflict(
    db: AsyncSession, exc: IntegrityError, cargo: ManifestCargo | None, operator_org_id: uuid.UUID,
) -> PPManifestAlreadyOnTripError | None:
    """Translate a lost manifest race into the same 409 the preview's pre-check gives.

    Returns None when this IntegrityError is something else, so the caller re-raises it.
    Matching on the index name, not on 23505 alone: trip_reference, trip_stops and
    trip_trailers carry unique constraints that can fire at the very same flush."""
    if cargo is None or not is_unique_violation(exc) or violated_constraint(exc) != PP_MANIFEST_INDEX:
        return None
    if not await rollback_after_error(db):
        raise exc
    winner = await find_live_trip_for_manifest(db, operator_organization_id=operator_org_id, key=cargo.key)
    logger.warning("Lost PP manifest race for %s (org %s)", cargo.key, operator_org_id)
    return PPManifestAlreadyOnTripError(
        trip_id=winner.id if winner is not None else None,
        trip_reference=winner.trip_reference if winner is not None else None,
    )


async def _sync_cargo_entry(
    db: AsyncSession, pp_reference: str, sync: Awaitable["ConsignmentSyncResult"],
    operator_org_id: uuid.UUID,
) -> "ConsignmentSyncResult":
    """Run one consignment sync with trip creation's fail-closed error mapping: any
    failure rolls back the whole trip, because a trip whose cargo plan couldn't be
    written has no manifest, no linehaul, and no evidence value."""
    try:
        return await sync
    except SQLAlchemyError:
        await rollback_after_error(db)
        raise
    except ConsignmentAlreadyAssignedError as exc:
        if not await rollback_after_error(db):
            raise type(exc)(exc.pp_reference, None) from exc
        owner_id = (await db.execute(
            select(Trip.operator_organization_id)
            .join(Consignment, Consignment.trip_id == Trip.id)
            .where(Consignment.parcel_perfect_reference == exc.pp_reference)
        )).scalar_one_or_none()
        if owner_id != operator_org_id:
            raise type(exc)(exc.pp_reference, None) from exc
        raise
    except Exception as exc:
        logger.error("Consignment sync failed for pp_ref=%s: %s", pp_reference, exc)
        await rollback_after_error(db)
        raise PPSyncError(pp_reference, str(exc)) from exc


def _build_phase_events(
    trip_id: uuid.UUID,
    trip_stops: list[TripStop],
    consignment_results: list["ConsignmentSyncResult"],
) -> list[PhaseEvent]:
    """Turn a trip's stops + synced consignments into its full committed phase plan.

    Pure: takes plain in-memory objects (already-flushed TripStop rows with real
    ids, and the consignment sync results with pickup/delivery stops stamped),
    returns unattached PhaseEvent objects. Caller (create_trip) does db.add()/flush()
    — kept out of this function so it stays unit-testable without a session.
    """
    stop_id_by_sequence = {s.sequence: s.id for s in trip_stops}
    plan_stops = [
        PlanStop(
            sequence=stop.sequence,
            picks_up=any(r.consignment.pickup_stop_id == stop.id for r in consignment_results),
            drops_off=any(r.consignment.delivery_stop_id == stop.id for r in consignment_results),
        )
        for stop in trip_stops
    ]
    planned_phases = build_phase_plan(plan_stops)

    return [
        PhaseEvent(
            trip_id=trip_id,
            phase_type=row.phase_type,
            sequence_number=row.sequence_number,
            trip_stop_id=(
                stop_id_by_sequence[row.stop_sequence] if row.stop_sequence is not None else None
            ),
            status=PhaseStatus.PENDING,
            anchor_status=(
                AnchorStatus.PENDING if row.phase_type in ANCHORED_PHASES else AnchorStatus.NOT_REQUIRED
            ),
        )
        for row in planned_phases
    ]


async def create_trip(
    db: AsyncSession,
    payload: TripCreateRequest,
    current_user: UserRead,
) -> TripDetailResponse:
    """POST /trips — the explicit path (empty legs, multi-stop trips, seeds, tests).
    See persist_trip for what is written and raised."""
    stops = payload.stops or [
        TripStopCreate(precinct_id=payload.origin_precinct_id, sequence=0),
        TripStopCreate(precinct_id=payload.destination_precinct_id, sequence=1),
    ]
    return await persist_trip(
        db,
        NewTrip(
            driver_id=payload.driver_id,
            horse_id=payload.horse_id,
            trailer_ids=payload.trailer_ids,
            stops=stops,
            trip_type=payload.trip_type,
            planned_departure_at=payload.planned_departure_at,
            planned_arrival_at=payload.planned_arrival_at,
            template_id=payload.template_id,
            consignment_refs=payload.consignments,
        ),
        current_user,
    )


def _journey_lock_payload(
    trip: Trip, new_trip: NewTrip, trip_stops: list[TripStop], *, creator_id: uuid.UUID,
) -> dict[str, Any]:
    """The journey lock (spec §9): one fixed key set. The manifest fields are null on the
    explicit path; planned times are locked as stored on the trip row.

    Stops come from the rows just persisted (sorted by sequence), so the lock commits to exactly what
    verification will read back; slot_time is UTC-normalised by the hasher on both sides.
    """
    cargo = new_trip.manifest
    return compute_trip_canonical_payload_v2(
        trip_id=trip.id,
        driver_id=new_trip.driver_id,
        horse_id=new_trip.horse_id,
        trailer_ids=new_trip.trailer_ids,
        origin_precinct_id=trip_stops[0].precinct_id,
        destination_precinct_id=trip_stops[-1].precinct_id,
        created_by_user_id=creator_id,
        created_at=trip.created_at,
        trip_type=new_trip.trip_type.value,
        pp_manifest=cargo.key if cargo else None,
        pp_manifest_snapshot_sha256=cargo.snapshot_sha256 if cargo else None,
        planned_departure_at=trip.planned_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        stops=[StopCommitment(s.sequence, s.precinct_id, s.slot_time) for s in trip_stops],
    )


async def _sync_consignments(
    db: AsyncSession, new_trip: NewTrip, trip: Trip, operator_org_id: uuid.UUID,
) -> list["ConsignmentSyncResult"]:
    """Sync every consignment the trip names, from its manifest and from its bare references."""
    cargo = new_trip.manifest
    consignment_results: list["ConsignmentSyncResult"] = []
    if cargo is not None or new_trip.consignment_refs:
        from app.orchestration.consignments.sync import (
            fetch_and_sync_consignment,
            sync_consignment_from_waybill,
        )

        if cargo is not None:
            for waybill in sorted(cargo.waybills, key=lambda w: w.details.waybill):
                consignment_results.append(await _sync_cargo_entry(
                    db, waybill.details.waybill,
                    sync_consignment_from_waybill(
                        db, waybill, trip_id=trip.id,
                        origin_precinct_id=trip.origin_precinct_id,
                        destination_precinct_id=trip.destination_precinct_id,
                    ),
                    operator_org_id,
                ))
        for entry in sorted(new_trip.consignment_refs, key=lambda e: e.pp_reference):
            consignment_results.append(await _sync_cargo_entry(
                db, entry.pp_reference,
                fetch_and_sync_consignment(
                    db,
                    pp_reference=entry.pp_reference,
                    trip_id=trip.id,
                    unit_count_expected=entry.unit_count_expected,
                    origin_precinct_id=trip.origin_precinct_id,
                    destination_precinct_id=trip.destination_precinct_id,
                ),
                operator_org_id,
            ))
    return consignment_results


async def persist_trip(
    db: AsyncSession,
    new_trip: NewTrip,
    current_user: UserRead,
) -> TripDetailResponse:
    """Create a Trip, TripTrailer rows, TripStop rows, its consignments and the full
    committed phase plan atomically — every PhaseEvent row the trip will ever need,
    all `pending` at creation — then anchor the journey lock and complete H0.

    Both creation endpoints come through here, so there is one evidence path (FP-281).

    Raises:
        ResourceNotFoundError: driver, horse, or any trailer is not found/inactive.
        PPManifestAlreadyOnTripError: lost the race for this manifest (uq_trips_pp_manifest).
        CrewUnavailableError: the driver, horse or a trailer is busy in this trip's window.
        ConsignmentAlreadyAssignedError: a waybill is on another trip.
        PPSyncError: a waybill could not be pulled or written.
    """
    cargo = new_trip.manifest

    await _assert_precincts_visible(db, new_trip.stops, current_user.organization_id)

    driver, horse, trailers = await _claim_crew(db, new_trip, current_user.organization_id)

    trip_id = uuid.uuid4()
    trip = Trip(
        id=trip_id,
        trip_reference=_generate_trip_reference(),
        operator_organization_id=current_user.organization_id,
        client_organization_id=cargo.client_organization_id if cargo else None,
        pp_manifest_issuer_account=cargo.key.issuer_account if cargo else None,
        pp_manifest_origin_hub=cargo.key.origin_hub if cargo else None,
        pp_manifest_number=cargo.key.number if cargo else None,
        driver_id=new_trip.driver_id,
        horse_id=new_trip.horse_id,
        template_id=new_trip.template_id,
        planned_departure_at=new_trip.planned_departure_at,
        planned_arrival_at=new_trip.planned_arrival_at,
        status=TripStatus.CREATED,
        trip_type=new_trip.trip_type.value,
        idvs_check_status=IdvsStatus.PENDING,
        created_by_user_id=current_user.id,
    )
    db.add(trip)

    for vehicle in trailers:
        db.add(
            TripTrailer(
                trip_id=trip_id,
                trailer_id=vehicle.id,
                pulsit_device_id_snapshot=vehicle.pulsit_device_id,
            )
        )

    trip_stops = [
        TripStop(
            trip_id=trip_id,
            precinct_id=spec.precinct_id,
            sequence=spec.sequence,
            slot_time=spec.slot_time,
            notes=spec.notes,
        )
        for spec in new_trip.stops
    ]
    for stop in trip_stops:
        db.add(stop)
    trip_stops.sort(key=lambda s: s.sequence)
    trip.origin_precinct_id = trip_stops[0].precinct_id
    trip.destination_precinct_id = trip_stops[-1].precinct_id

    try:
        await db.flush()
    except IntegrityError as exc:
        conflict = await _manifest_conflict(db, exc, cargo, current_user.organization_id)
        if conflict is None:
            raise
        raise conflict from exc
    for stop in trip_stops:
        await db.refresh(stop)

    consignment_results = await _sync_consignments(db, new_trip, trip, current_user.organization_id)

    for result in consignment_results:
        result.consignment.pickup_stop_id = trip_stops[0].id
        result.consignment.delivery_stop_id = trip_stops[-1].id

    phase_events = _build_phase_events(trip_id, trip_stops, consignment_results)
    for event in phase_events:
        db.add(event)
    await db.flush()

    h0 = phase_events[0]
    if cargo is not None:
        h0.parcel_manifest_snapshot = cargo.snapshot

    canonical = _journey_lock_payload(trip, new_trip, trip_stops, creator_id=current_user.id)
    lock_hash = compute_journey_lock_hash(canonical)
    trip.journey_lock_hash = lock_hash

    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.TRIP,
        subject_id=trip_id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.JOURNEY_LOCK,
        trip_id=trip_id,
    )

    h0.status = PhaseStatus.COMPLETED
    h0.completed_at = datetime.now(UTC)
    h0.blockchain_receipt_id = receipt.id
    h0.event_hash = compute_payload_hash(canonical)
    h0.anchor_status = AnchorStatus.ANCHORED

    await recompute_position(db, trip)

    await db.flush()
    await db.refresh(trip)
    await db.refresh(h0)
    await db.refresh(receipt)
    for result in consignment_results:
        await db.refresh(result.consignment)

    enqueue_event(db, current_user.organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CREATED))

    gate = await blocked_on_by_stop(db, trip_id=trip.id)
    return TripDetailResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        pp_manifest=PPManifestRef.from_columns(
            issuer_account=trip.pp_manifest_issuer_account,
            origin_hub=trip.pp_manifest_origin_hub,
            number=trip.pp_manifest_number,
            client_name=cargo.client_name if cargo else None,
        ),
        status=trip.status,
        trip_type=TripType(trip.trip_type),
        journey_lock_hash=trip.journey_lock_hash,
        idvs_check_status=trip.idvs_check_status,
        driver=DriverRead.model_validate(driver),
        horse=VehicleRead.model_validate(horse),
        trailers=[VehicleRead.model_validate(v) for v in trailers],
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        stops=[TripStopRead.model_validate(s) for s in trip_stops],
        consignments=[ConsignmentRead.model_validate(r.consignment) for r in consignment_results],
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
                e,
                stop_sequence_by_id={s.id: s.sequence for s in trip_stops},
                blocked_on_by_stop=gate,
            )
            for e in phase_events
        ],
        exceptions=[],
        blockchain_receipts=[BlockchainReceiptRead.model_validate(receipt)],
        warnings=[r.warning for r in consignment_results if r.warning],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )
