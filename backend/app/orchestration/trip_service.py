"""Trip orchestration — create_trip() is the single entry point for trip creation.

Layering: this module imports from db/, crypto/, and schemas/ only.
It must never import from api/ or auth/.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import case, exists, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import (
    ConsignmentAlreadyAssignedError,
    PPSyncError,
    ResourceNotFoundError,
    TripConflictError,
    TripStateError,
)
from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType,
    IdvsStatus, PhaseStatus, SubjectType, TripStatus, TripType, VehicleType,
)
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_gate import blocked_on_by_stop
from app.orchestration.phase_plan import ANCHORED_PHASES, PlanStop, build_phase_plan
from app.orchestration.phase_service import recompute_position
from app.orchestration.resource_service import get_trip_detail
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.phases import PhaseEventRead
from app.schemas.people import DriverRead, UserRead
from app.schemas.trips import (
    ConsignmentRead,
    DriverTripListItemResponse,
    TripCreateRequest,
    TripDetailResponse,
    TripStopCreate,
    TripStopRead,
)
from app.schemas.vehicles import VehicleRead

if TYPE_CHECKING:
    # Type-only — the runtime import stays local to create_trip (see below) to
    # avoid a module-load cycle (trip_service -> consignment_service -> trip_service).
    # A TYPE_CHECKING-only import carries no such risk: it never executes at runtime.
    from app.orchestration.consignment_service import ConsignmentSyncResult

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


async def _check_order_number_conflict(
    db: AsyncSession,
    order_number: str,
    operator_org_id: uuid.UUID,
) -> None:
    """Raise TripConflictError if an active trip already has this order_number."""
    # Coarse set post-Stage-2.2 (T6) — the old per-handshake TripStatus values
    # are gone; ACTIVE now covers everything between activation and closing.
    # EXCEPTION_HOLD is currently unreachable (nothing in app/ sets it — see
    # phase_service._is_resolved) but stays listed: a held trip is by definition
    # still live cargo, so it must keep blocking a duplicate order_number if and
    # when a manual dispatcher hold introduces the status.
    active_statuses = [
        TripStatus.CREATED,
        TripStatus.ACTIVE,
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
    """Create a Trip, TripTrailer rows, TripStop rows, and the trip's full committed
    phase plan atomically — every PhaseEvent row the trip will ever need (H0/
    trip_creation plus activation/loading/departure/in_transit/unloading/confirmation
    per stop), all `pending` at creation, H0 included. H0 is `phase_events[0]`,
    guaranteed by build_phase_plan to be `trip_creation` at sequence 0.

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

    # 3. Create the Trip row. origin/destination_precinct_id are set below once the
    #    route's stops are known (they're a derived convenience, not authoritative — FP-112).
    trip_id = uuid.uuid4()
    trip = Trip(
        id=trip_id,
        trip_reference=_generate_trip_reference(),
        order_number=payload.order_number,
        operator_organization_id=current_user.organization_id,
        client_organization_id=None,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        template_id=payload.template_id,
        planned_departure_at=payload.planned_departure_at,
        planned_arrival_at=payload.planned_arrival_at,
        status=TripStatus.CREATED,
        trip_type=payload.trip_type.value,
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

    # 5. Create TripStop rows — the explicit route if given, else synthesise the
    #    back-compat single-leg pair from origin/destination precincts (FP-112 A.3).
    #    Consignment rows ARE created below (PP sync loop); their pickup_stop_id/
    #    delivery_stop_id are stamped stop-0 -> stop-last once synced (see below) —
    #    TripConsignmentInput has no per-consignment stop reference yet, so every
    #    consignment runs the full route until that schema gap is closed.
    stop_specs: list[TripStopCreate] = payload.stops or [
        TripStopCreate(precinct_id=payload.origin_precinct_id, sequence=0),
        TripStopCreate(precinct_id=payload.destination_precinct_id, sequence=1),
    ]
    trip_stops = [
        TripStop(
            trip_id=trip_id,
            precinct_id=spec.precinct_id,
            sequence=spec.sequence,
            slot_time=spec.slot_time,
            notes=spec.notes,
        )
        for spec in stop_specs
    ]
    for stop in trip_stops:
        db.add(stop)
    trip_stops.sort(key=lambda s: s.sequence)
    trip.origin_precinct_id = trip_stops[0].precinct_id
    trip.destination_precinct_id = trip_stops[-1].precinct_id

    # Flush trip + trailers + stops before adding the PhaseEvent. The evidence_artifacts
    # table has a use_alter=True FK back to trips, creating a circular dependency
    # in SQLAlchemy's unit-of-work topological sort. Without an explicit flush here,
    # the sort can emit the PhaseEvent INSERT before trips, violating the FK.
    await db.flush()
    for stop in trip_stops:
        await db.refresh(stop)

    # Sync every consignment from PP (loaded trips). Fail-closed and atomic: any PP
    # error rolls back the whole trip — a trip whose cargo plan couldn't be pulled
    # has no manifest, no linehaul, and no evidence value. Local import avoids a
    # module-load cycle (trip_service → consignment_service → parcel_perfect).
    consignment_results: list["ConsignmentSyncResult"] = []
    if payload.consignments:
        from app.orchestration.consignment_service import fetch_and_sync_consignment

        for entry in payload.consignments:
            try:
                consignment_results.append(
                    await fetch_and_sync_consignment(
                        db,
                        pp_reference=entry.pp_reference,
                        trip_id=trip.id,
                        unit_count_expected=entry.unit_count_expected,
                        origin_precinct_id=trip.origin_precinct_id,
                        destination_precinct_id=trip.destination_precinct_id,
                    )
                )
            except SQLAlchemyError:
                # DB faults are not PP faults — re-raise unchanged so the endpoint's
                # SQLAlchemyError handler keeps its 500 semantics instead of a misleading 422.
                await db.rollback()
                raise
            except ConsignmentAlreadyAssignedError:
                # Nor is this a PP fault: PP answered, and the waybill is real. The
                # conflict is ours, so it must not be relabelled as a PP sync failure -
                # a dispatcher told "Parcel Perfect rejected a waybill" would go and
                # check PP, where they would find nothing wrong. Rolled back for the
                # same reason as below, then re-raised for the endpoint's 409.
                await db.rollback()
                raise
            except Exception as exc:
                # PP failures (bad waybill, network error) must not create a trip
                # with missing consignment data. Explicit rollback undoes the Trip/
                # TripStop/TripTrailer rows already flushed above — get_db() rolls
                # back on exception in production, but this keeps the guarantee
                # session-implementation-independent (e.g. under test overrides
                # that don't replicate that behaviour). Re-raised as PPSyncError so
                # the endpoint can return a 422 with a meaningful message.
                logger.error("PP sync failed for pp_ref=%s: %s", entry.pp_reference, exc)
                await db.rollback()
                raise PPSyncError(entry.pp_reference, str(exc)) from exc

    # Stamp the route onto every synced consignment: stop-0 pickup, stop-last
    # delivery. TripConsignmentInput (schemas/trips.py) carries no per-consignment
    # stop reference yet (pre-existing schema gap, flagged at (5) above) — every
    # consignment therefore runs the full route until that's extended. build_phase_plan
    # below reads these two fields to decide which stops load/unload.
    for result in consignment_results:
        result.consignment.pickup_stop_id = trip_stops[0].id
        result.consignment.delivery_stop_id = trip_stops[-1].id

    # 6. Build and write the trip's full committed phase plan (parent plan D5/D6).
    #    Every phase row for every stop is created here, `pending`, in plan order —
    #    a later task's completion engine fills them in one at a time. No code path
    #    outside create_trip may insert a PhaseEvent after this stage lands (not yet
    #    enforced beyond convention — a later stage may want a DB-level guard).
    phase_events = _build_phase_events(trip_id, trip_stops, consignment_results)
    for event in phase_events:
        db.add(event)
    await db.flush()

    # trip_creation is always sequence 0 with a NULL stop (D3) — build_phase_plan
    # guarantees this, so h0 is simply the first row of the plan just written.
    h0 = phase_events[0]

    # 7. Compute journey lock hash over the immutable trip parameters.
    #    Uses trip.origin/destination_precinct_id (derived from the stop route, always set)
    #    rather than payload.origin/destination_precinct_id, which are None on the explicit-
    #    stops path. Payload shape is unchanged from pre-FP-112 — FP-113 extends it to cover
    #    the full route; no real multi-stop trip should be anchored before that lands.
    lock_hash = compute_journey_lock_hash(
        trip_id=trip_id,
        order_number=payload.order_number,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        trailer_ids=payload.trailer_ids,
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=current_user.id,
        created_at=trip.created_at,
        trip_type=payload.trip_type.value,
    )
    canonical = compute_trip_canonical_payload(
        trip_id=trip_id,
        order_number=payload.order_number,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        trailer_ids=payload.trailer_ids,
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=current_user.id,
        created_at=trip.created_at,
        trip_type=payload.trip_type.value,
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

    # U4: derive the cache from the ledger now that h0 is resolved. Note this call
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

    # Notify dispatchers in this org that a new trip exists (published on commit, D9).
    enqueue_event(db, current_user.organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CREATED))

    # 8. Assemble and return the response (no ORM relationships — fetch separately).
    gate = await blocked_on_by_stop(db, trip_id=trip.id)
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


# Machine-findable marker for the acting dispatcher on a cancellation's ledger entry.
# A stable prefix, not free prose, so the actor stays greppable (and parseable by a
# future migration that moves it into a real raised_by_user_id column).
_CANCELLED_BY_PREFIX = "Cancelled by user "


async def cancel_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
    user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for a trip abandoned mid-plan (task 6.1).

    Before this, nothing in app/ ever wrote TripStatus.CANCELLED — an abandoned
    trip (cargo pulled, vehicle broken down) sat ACTIVE forever, and worse,
    phase_service._reject_if_another_trip_underway then blocked that driver from
    EVER activating another trip. Cancel is the only exit; it is also a promise
    the dispatcher wizard's confirmation modal already makes to the user.

    Raises ResourceNotFoundError (404) if the trip doesn't exist or belongs to a
    different org, and TripStateError (409) if it is already CLOSED or CANCELLED.
    """
    result = await db.execute(
        select(Trip).where(
            Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id,
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action="cancel")

    trip.status = TripStatus.CANCELLED
    trip.closed_at = datetime.now(UTC)

    # Phase rows are deliberately left untouched — they stay whatever they were
    # (most still PENDING), which is the honest record of a plan abandoned partway
    # through. Cancelling is not completing, so nothing here marks them resolved.
    #
    # recompute_position() is deliberately NOT called either: it derives the
    # position of a plan that is no longer being walked, and its close-branch
    # would overwrite this CANCELLED write with CLOSED — a trap a future reader
    # chasing "why isn't the trip cancelled any more" would otherwise walk into.

    # D5: the human intervention lands on the ledger, not just in an audit column.
    #
    # The acting dispatcher is carried in the description rather than a column
    # because TripException has no raised_by_user_id — only resolved_by_user_id.
    # override_phase escapes this via PhaseEvent.dispatcher_override_user_id, but a
    # cancellation has no phase row to hang an actor on, and an anonymous "this trip
    # was abandoned" record is exactly the kind of unattributable evidence this
    # platform exists to avoid. Deliberate no-migration stopgap: the proper fix is a
    # raised_by_user_id column, which is a schema change and its own task.
    db.add(TripException(
        trip_id=trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        description=f"{_CANCELLED_BY_PREFIX}{user_id}: {note}",
    ))
    await db.flush()

    # D9: published on commit — the dispatcher's list must drop this trip from
    # Active on the same refetch trip_closed already triggers.
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CLOSED))

    return await get_trip_detail(
        db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id,
    )


async def get_active_trip_for_driver(db: AsyncSession, driver_id: uuid.UUID) -> TripDetailResponse | None:
    """Return the trip the driver is currently working, or None. Excludes closed/cancelled.

    Nothing at trip creation stops a dispatcher assigning a second trip while the
    driver's current one sits in exception_hold, so more than one non-terminal row
    can legitimately exist — scalar_one_or_none() would turn that into a 500 for
    the driver, so one row is picked instead.

    Which row matters. Ordering by created_at alone (the original behaviour) let a
    freshly-assigned CREATED trip outrank the trip the driver was physically in the
    middle of driving, because the dispatcher had assigned it more recently: Home
    would swap to tomorrow's un-activated assignment mid-journey. A trip the driver
    has actually activated therefore outranks a mere assignment.

    Within a rank the SOONEST departure wins, not the newest row. created_at is when
    the dispatcher happened to type the trip in, which has nothing to do with the
    order the driver runs them: two assignments captured back-to-back, one leaving on
    the 5th and one on the 6th, handed Home the 6th purely because it was saved last.
    Departure order is also the order the driver is permitted to work in —
    phase_service's activation gates refuse a trip while an earlier one that day is
    still unstarted — so this makes Home agree with what the driver can actually do.

    A departure already in the past therefore still sorts first: an assignment that
    should have left this morning is overdue, not stale, and hiding it behind
    tomorrow's would leave the driver looking at the wrong job. Trips with no planned
    departure at all sort last — unscheduled cannot be "next".

    CREATED stays eligible as a fallback rather than being excluded outright: the
    Activation phase (which is what flips CREATED -> ACTIVE) is reached through
    this trip, so a driver whose only trip is an un-activated assignment must still
    be handed it or they could never start work.
    """
    inactive = {TripStatus.CLOSED, TripStatus.CANCELLED}
    # Rank, not sort key: every underway status shares rank 0 so departure order still
    # decides between two of them. ACTIVE and EXCEPTION_HOLD are peers — a held trip
    # is still the trip the driver is on, it is just blocked from advancing.
    underway_first = case(
        (Trip.status.in_((TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD)), 0),
        else_=1,
    )
    result = await db.execute(
        select(Trip)
        .where(Trip.driver_id == driver_id, Trip.status.notin_(inactive))
        .order_by(
            underway_first,
            Trip.planned_departure_at.asc().nulls_last(),
            # Last resort only, for two trips leaving at the same minute (or two
            # unscheduled ones): keeps the result deterministic instead of letting
            # Postgres return whichever row it reaches first.
            Trip.created_at.desc(),
        )
    )
    trip = result.scalars().first()
    if trip is None:
        return None
    # Deliberate asymmetry with GET /trips/{id} (which strips receipts for
    # non-admin dispatchers): the driver's own active trip keeps its
    # blockchain_receipts because the PWA anchor UI renders them. Receipts
    # carry hashes/tx ids only — no PII (POPIA-safe). Covered by
    # test_active_trip_includes_receipts_for_driver.
    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


async def list_trips_for_driver(
    db: AsyncSession, driver_id: uuid.UUID
) -> list[DriverTripListItemResponse]:
    """Every trip assigned to this driver, newest first — backs GET /trips/me.

    Scoped by driver_id alone, never by organisation: a driver is assigned trips
    directly and has no dispatcher org context to filter on. This is the whole
    authorisation boundary for the endpoint, which is why the driver_id comes from
    the verified token (get_current_driver) and never from the request.

    Returns all statuses including CLOSED and CANCELLED. The PWA needs the terminal
    rows to populate its Past tab, and grouping is the client's job — filtering them
    out here would make a completed-trip history impossible to build.
    """
    trips = (
        (
            await db.execute(
                select(Trip)
                .where(Trip.driver_id == driver_id)
                .order_by(Trip.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    # Batched, not per-row: same N+1 guard as resource_service.list_trips().
    # Both FKs are nullable on Trip, so Nones are dropped before the IN clause.
    precinct_ids = {
        pid
        for t in trips
        for pid in (t.origin_precinct_id, t.destination_precinct_id)
        if pid is not None
    }
    precinct_names: dict[uuid.UUID, str] = {
        p.id: p.name
        for p in (
            await db.execute(select(Precinct).where(Precinct.id.in_(precinct_ids)))
        )
        .scalars()
        .all()
    }

    def precinct_name(precinct_id: uuid.UUID | None) -> str | None:
        return None if precinct_id is None else precinct_names.get(precinct_id)

    exc_counts: dict[uuid.UUID, int] = {
        row[0]: row[1]
        for row in (
            await db.execute(
                select(TripException.trip_id, func.count(TripException.id))
                .where(
                    TripException.trip_id.in_(trip_ids),
                    TripException.resolved.is_(False),
                )
                .group_by(TripException.trip_id)
            )
        ).all()
    }

    return [
        DriverTripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            order_number=t.order_number,
            status=t.status,
            trip_type=t.trip_type,
            origin_precinct_id=t.origin_precinct_id,
            destination_precinct_id=t.destination_precinct_id,
            origin_precinct_name=precinct_name(t.origin_precinct_id),
            destination_precinct_name=precinct_name(t.destination_precinct_id),
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


async def get_own_trip_detail_for_driver(
    db: AsyncSession, *, driver_id: uuid.UUID, trip_id: uuid.UUID
) -> TripDetailResponse:
    """Full detail for one of THIS driver's trips — backs GET /trips/me/{trip_id}.

    Raises ResourceNotFoundError when the trip does not exist OR belongs to another
    driver. The two are deliberately indistinguishable: a driver enumerating trip
    UUIDs must not be able to tell a real trip from a stranger's one, so a
    404 covers both rather than a 403 confirming existence.

    Same receipt asymmetry as get_active_trip_for_driver — the driver keeps
    blockchain_receipts (hashes and tx ids only, no PII) because the PWA renders
    the anchor state.
    """
    trip = (
        await db.execute(
            select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id)
        )
    ).scalars().first()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return await get_trip_detail(
        db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id
    )
