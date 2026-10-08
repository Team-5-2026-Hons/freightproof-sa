"""Trip orchestration — persist_trip() is the single write path for trip creation:
create_trip() (POST /trips) and pp_manifest_service (POST /trips/from-pp-manifest)
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
    PPManifestAlreadyOnTripError,
    PPSyncError,
    ResourceNotFoundError,
)
from app.crypto.hashing import PPManifestKey, compute_journey_lock_hash, compute_trip_canonical_payload
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, IdvsStatus, PhaseStatus, SubjectType, TripStatus,
    TripType, VehicleType,
)
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.trips import (
    PP_MANIFEST_INDEX, Trip, TripStop, TripTrailer,
)
from app.db.models.vehicles import Vehicle
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.phases.plan import ANCHORED_PHASES, PlanStop, build_phase_plan
from app.orchestration.phases.state import recompute_position
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
)
from app.schemas.vehicles import VehicleRead

if TYPE_CHECKING:
    # Type-only — the runtime import stays local to persist_trip (see below). No
    # module-load cycle exists today (consignment_service reaches only integrity,
    # integrations/ and db/), so the local import is a leftover from before the split
    # and may be promoted in its own commit. A TYPE_CHECKING-only import carries no
    # such risk: it never executes at runtime.
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


@dataclass(frozen=True)
class ManifestCargo:
    """A loaded trip's cargo exactly as the PP manifest supplied it (FP-281). Already
    fetched and validated by pp_manifest_service; persist_trip makes no PP call for it."""

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
    # Explicit path: waybill references pulled from PP one at a time.
    consignment_refs: list[TripConsignmentInput] = field(default_factory=list)
    # Manifest path: the waybills already arrived with the manifest.
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
    # Rolled back here rather than relying on get_db(), as the other failure paths do.
    await db.rollback()
    winner = await find_live_trip_for_manifest(db, operator_organization_id=operator_org_id, key=cargo.key)
    logger.warning("Lost PP manifest race for %s (org %s)", cargo.key, operator_org_id)
    return PPManifestAlreadyOnTripError(
        trip_id=winner.id if winner is not None else None,
        trip_reference=winner.trip_reference if winner is not None else None,
    )


async def _sync_cargo_entry(
    db: AsyncSession, pp_reference: str, sync: Awaitable["ConsignmentSyncResult"],
) -> "ConsignmentSyncResult":
    """Run one consignment sync with trip creation's fail-closed error mapping: any
    failure rolls back the whole trip, because a trip whose cargo plan couldn't be
    written has no manifest, no linehaul, and no evidence value."""
    try:
        return await sync
    except SQLAlchemyError:
        # DB faults are not PP faults — re-raise unchanged so the endpoint's
        # SQLAlchemyError handler keeps its 500 semantics instead of a misleading 422.
        await db.rollback()
        raise
    except ConsignmentAlreadyAssignedError:
        # Nor is this a PP fault: the waybill is real and the conflict is ours, so it
        # must not be relabelled as a PP sync failure. Re-raised for the endpoint's 409.
        await db.rollback()
        raise
    except Exception as exc:
        # Explicit rollback keeps the guarantee independent of the session implementation
        # (test overrides don't replicate get_db's rollback-on-exception).
        logger.error("Consignment sync failed for pp_ref=%s: %s", pp_reference, exc)
        await db.rollback()
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
    # When stops are omitted, synthesise the back-compat single-leg pair (FP-112 A.3);
    # validate_request guarantees both precincts are set in that case.
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
        ConsignmentAlreadyAssignedError: a waybill is on another trip.
        PPSyncError: a waybill could not be pulled or written.
    """
    cargo = new_trip.manifest

    # 1. Validate all referenced records exist before any writes.
    driver = await _fetch_driver(db, new_trip.driver_id, current_user.organization_id)
    horse = await _fetch_vehicle(db, new_trip.horse_id, VehicleType.HORSE, current_user.organization_id)
    trailers: list[Vehicle] = []
    for trailer_id in new_trip.trailer_ids:
        trailers.append(
            await _fetch_vehicle(db, trailer_id, VehicleType.TRAILER, current_user.organization_id)
        )

    # 2. Create the Trip row. origin/destination_precinct_id are set below once the
    #    route's stops are known (a derived convenience, not authoritative — FP-112).
    trip_id = uuid.uuid4()
    trip = Trip(
        id=trip_id,
        trip_reference=_generate_trip_reference(),
        operator_organization_id=current_user.organization_id,
        # Set only for manifest trips: a manifest names one client (spec §6). The
        # explicit path stays per-consignment (multi-client trips, FP-112).
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

    # 5. Create TripStop rows from the route.
    #    Consignment rows ARE created below (PP sync loop); their pickup_stop_id/
    #    delivery_stop_id are stamped stop-0 -> stop-last once synced (see below) —
    #    TripConsignmentInput has no per-consignment stop reference yet, so every
    #    consignment runs the full route until that schema gap is closed.
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

    # Flush trip + trailers + stops before adding the PhaseEvent. The evidence_artifacts
    # table has a use_alter=True FK back to trips, creating a circular dependency in
    # SQLAlchemy's unit-of-work topological sort. Without an explicit flush here, the sort
    # can emit the PhaseEvent INSERT before trips, violating the FK.
    #
    # It is also where the trip INSERT lands, and so where a lost manifest race surfaces:
    # the dispatcher who inserted first commits, and the second insert is refused by
    # uq_trips_pp_manifest.
    try:
        await db.flush()
    except IntegrityError as exc:
        conflict = await _manifest_conflict(db, exc, cargo, current_user.organization_id)
        if conflict is None:
            raise
        raise conflict from exc
    for stop in trip_stops:
        await db.refresh(stop)

    # Sync every consignment. Local import kept from before the split; no module-load
    # cycle exists today (consignment_service → parcel_perfect never imports back here).
    consignment_results: list["ConsignmentSyncResult"] = []
    if cargo is not None or new_trip.consignment_refs:
        from app.orchestration.consignments.sync import (
            fetch_and_sync_consignment,
            sync_consignment_from_waybill,
        )

        if cargo is not None:
            # Scan ingestion locks this same bytewise waybill order. Sort even if
            # PP returns a different order, so multi-waybill scans cannot deadlock.
            for waybill in sorted(cargo.waybills, key=lambda w: w.details.waybill):
                consignment_results.append(await _sync_cargo_entry(
                    db, waybill.details.waybill,
                    sync_consignment_from_waybill(
                        db, waybill, trip_id=trip.id,
                        origin_precinct_id=trip.origin_precinct_id,
                        destination_precinct_id=trip.destination_precinct_id,
                    ),
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
            ))

    # Stamp the route onto every synced consignment: stop-0 pickup, stop-last
    # delivery. TripConsignmentInput (schemas/trips.py) carries no per-consignment
    # stop reference yet (pre-existing schema gap, flagged at (5) above) — every
    # consignment therefore runs the full route until that's extended. build_phase_plan
    # below reads these two fields to decide which stops load/unload.
    for result in consignment_results:
        result.consignment.pickup_stop_id = trip_stops[0].id
        result.consignment.delivery_stop_id = trip_stops[-1].id

    # 6. Build and write the trip's full committed phase plan.
    #    Every phase row for every stop is created here, `pending`, in plan order —
    #    a later task's completion engine fills them in one at a time. No code path
    #    outside create_trip may insert a PhaseEvent after this stage lands (not yet
    #    enforced beyond convention — a later stage may want a DB-level guard).
    phase_events = _build_phase_events(trip_id, trip_stops, consignment_results)
    for event in phase_events:
        db.add(event)
    await db.flush()

    # trip_creation is always sequence 0 with a NULL stop — build_phase_plan
    # guarantees this, so h0 is simply the first row of the plan just written.
    h0 = phase_events[0]
    # The PP manifest as it stood at creation, stored on H0 (spec §7.3): the record the
    # journey lock's snapshot hash is recomputed from. Dispatcher-only (see PhaseEventRead).
    if cargo is not None:
        h0.parcel_manifest_snapshot = cargo.snapshot

    # 7. The journey lock (spec §9): one fixed key set. The manifest fields are null on
    #    the explicit path; planned times are locked as stored on the trip row.
    canonical = compute_trip_canonical_payload(
        trip_id=trip_id,
        driver_id=new_trip.driver_id,
        horse_id=new_trip.horse_id,
        trailer_ids=new_trip.trailer_ids,
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=current_user.id,
        created_at=trip.created_at,
        trip_type=new_trip.trip_type.value,
        pp_manifest=cargo.key if cargo else None,
        pp_manifest_snapshot_sha256=cargo.snapshot_sha256 if cargo else None,
        planned_departure_at=trip.planned_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
    )
    lock_hash = compute_journey_lock_hash(canonical)
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

    # H0 (trip_creation) completes inline, right here: reaching this line means
    # anchor_subject succeeded (it's fail-closed — a failure raises and rolls back
    # the whole trip above), so trip creation itself IS h0's completion event.
    # Without this, h0 stays PENDING forever and _gate_and_load's "all lower
    # sequence_numbers resolved" check blocks every later phase permanently,
    # since h0 is sequence 0 — the lowest possible.
    h0.status = PhaseStatus.COMPLETED
    h0.completed_at = datetime.now(UTC)
    h0.blockchain_receipt_id = receipt.id
    h0.event_hash = compute_payload_hash(canonical)
    h0.anchor_status = AnchorStatus.ANCHORED

    # Derive the cache from the ledger now that h0 is resolved. Note this call
    # would also CLOSE a trip whose every phase is resolved — unreachable here,
    # because build_phase_plan always emits at least `activation` after h0, and the
    # test asserts status is still CREATED so the day that changes it fails loudly.
    await recompute_position(db, trip)

    await db.flush()
    await db.refresh(trip)
    await db.refresh(h0)
    await db.refresh(receipt)
    # Consignment rows were flushed inside fetch_and_sync_consignment but never refreshed,
    # so their DB-generated created_at/updated_at stay expired. ConsignmentRead below reads
    # those columns; without a refresh the attribute access triggers a lazy reload in a sync
    # context (Pydantic model_validate) → MissingGreenlet → an unhandled 500. Refresh here,
    # mirroring the trip/handshake/receipt refreshes above.
    for result in consignment_results:
        await db.refresh(result.consignment)

    # Notify dispatchers in this org that a new trip exists (published on commit).
    enqueue_event(db, current_user.organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CREATED))

    # 8. Assemble and return the response (no ORM relationships — fetch separately).
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
        # The full committed plan, not just H0. POST and GET must describe the same
        # trip: returning one row here while GET /trips/{id} returns seven made the
        # phase list look like it grew between two reads of an unchanged trip.
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
