"""Seed the four demo trips: single-leg, cross-dock, in-flight, and closed.

The 13-row cross-dock trip is the point: it is the shape the old
UNIQUE(trip_id, handshake_type) constraint made unrepresentable, and it is what a
reviewer is walked through at the demo. Consignments A (stop 1->3), B (1->2) and
C (2->3) make stop 2 both a drop-off and a pick-up.

Every consignment's cargo data is READ FROM THE PP MOCK FIXTURE LIBRARY
(app/integrations/parcel_perfect.py), never invented here. This is not tidiness:
the seeder previously made up references PP had never heard of, so the dispatcher
wizard's fail-closed lookup returned 404 on the platform's own demo data. Any
reference in TRIP_SPECS that is missing from MOCK_WAYBILLS aborts the seed, and
tests/unit/test_seed_fixtures.py fails the build before it ever gets that far.

Deliberately writes rows directly rather than calling create_trip(): P0 anchoring is
fail-closed, so create_trip() would put a Hedera testnet round-trip in the middle of
a seed. Seeded trips therefore have journey_lock_hash = NULL and an unanchored P0 —
real anchoring is exercised by POST /trips, not by this script.

It also writes true per-leg consignment stops, which create_trip cannot yet do
(FP-113: every consignment there runs stop-0 -> stop-last). That is why the
cross-dock shape is reachable by seeding but not yet by the wizard.

Run scripts/dev_reset_lifecycle.py first if the database already has trips.

Usage:
    cd backend
    PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.crypto.hashing import PPManifestKey
from app.db.models.enums import (
    AnchorStatus, IdvsStatus, ParcelStatus, PhaseStatus, PhaseType, SealCondition, TripStatus, TripType,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations.parcel_perfect import MOCK_MANIFEST_HEADERS, MOCK_WAYBILLS, PPWaybillResponse
from app.orchestration.consignment_service import serialise_waybill
from app.orchestration.phases.plan import ANCHORED_PHASES, PlanStop, build_phase_plan

_CPT = "Cape Town Depot (Epping)"
_BFN = "Bloemfontein Depot (Hamilton)"
_JHB = "Johannesburg Depot (Linbro)"

# Consolidated-unit grain. PP reports parcels, never pallets, so a real dispatcher
# types this into the wizard; the seeder derives it the same way they would estimate
# it rather than leaving the trip-detail unit column empty on every demo trip.
_PARCELS_PER_PALLET = 6

# Walk every phase of the trip, whatever the plan's length. Spelled as a literal
# rather than a large int because the plan's length is data - the whole premise of
# the phase refactor - so no fixed number can mean "all of them".
_ADVANCE_ALL: Literal["all"] = "all"


@dataclass(frozen=True)
class _ConsignmentLeg:
    """One consignment's leg across a trip's route, by stop sequence.

    pp_reference must exist in MOCK_WAYBILLS - that fixture is the source of the
    consignment's parcel count, declared value, manifest and client account.
    """

    pp_reference: str
    pickup_sequence: int
    delivery_sequence: int


@dataclass(frozen=True)
class _TripSpec:
    """Everything that distinguishes one seeded trip from another."""

    trip_reference: str
    precinct_names: tuple[str, ...]
    consignments: tuple[_ConsignmentLeg, ...]
    # Format enforced by schemas/phases.py _SEAL_PATTERN - XX-####.
    seal_number: str
    # Mark rows up to and including this sequence COMPLETED. _ADVANCE_ALL walks the
    # whole plan, which closes the trip.
    advance_through: Optional[int | Literal["all"]] = None


TRIP_SPECS: tuple[_TripSpec, ...] = (
    # Single-leg: the degenerate case of the multi-stop plan. 8 rows.
    _TripSpec(
        trip_reference="FP-DEMO-SINGLE-0001",
        precinct_names=(_CPT, _JHB),
        consignments=(_ConsignmentLeg("MOCKWB0001", 1, 2),),
        seal_number="FP-4471",
    ),
    # Cross-dock: stop 2 is both a drop-off and a pick-up. 13 rows.
    _TripSpec(
        trip_reference="FP-DEMO-XDOCK-0001",
        precinct_names=(_CPT, _BFN, _JHB),
        consignments=(
            _ConsignmentLeg("MOCKWB0002", 1, 3),   # A: straight through
            _ConsignmentLeg("MOCKWB0003", 1, 2),   # B: dropped at the hub
            _ConsignmentLeg("MOCKWB0004", 2, 3),   # C: collected at the hub
        ),
        seal_number="FP-5182",
    ),
    # The in-flight trip. Same cross-dock shape, walked through seq 4 - trip_creation,
    # activation, loading, departure and the leg-1 in_transit are done; the trip sits
    # at `arrival` at stop 2. This is the trip a reviewer is walked through: it is
    # the only seed on which the derived-active marker, the coarse `active` status
    # filter, and a real seal + parcel count are all visible at once.
    _TripSpec(
        trip_reference="FP-DEMO-ACTIVE-0001",
        precinct_names=(_CPT, _BFN, _JHB),
        consignments=(
            _ConsignmentLeg("MOCKWB0005", 1, 3),   # A: straight through
            _ConsignmentLeg("MOCKWB0006", 1, 2),   # B: dropped at the hub
            _ConsignmentLeg("MOCKWB0007", 2, 3),   # C: collected at the hub
        ),
        seal_number="FP-6390",
        advance_through=4,
    ),
    # The finished trip. Every phase resolved, so recompute_position's closing rule
    # applies and the trip is CLOSED with a closed_at - without this seed nothing in
    # the dispatcher ever renders a completed custody chain, and the `closed` status
    # filter has no rows to return.
    _TripSpec(
        trip_reference="FP-DEMO-CLOSED-0001",
        precinct_names=(_CPT, _JHB),
        consignments=(_ConsignmentLeg("MOCKWB0008", 1, 2),),
        seal_number="FP-7204",
        advance_through=_ADVANCE_ALL,
    ),
)


def _manifest_key_for(spec: _TripSpec) -> PPManifestKey:
    """The seeded trip's PP manifest key, read from the PP mock like its cargo is — a
    trip keyed on a manifest PP has never heard of would contradict its own waybills."""
    number = MOCK_WAYBILLS[spec.consignments[0].pp_reference].details.manifest
    if number is None or number not in MOCK_MANIFEST_HEADERS:
        raise SystemExit(f"{spec.trip_reference}: its waybills sit on no mock manifest")
    header = MOCK_MANIFEST_HEADERS[number]
    return PPManifestKey(header.issuer_account, header.origin_hub, number)


# Every PP reference this seeder consumes. Exported so a unit test can assert the
# seeder and the PP mock library have not drifted apart again.
SEEDED_WAYBILL_REFERENCES: frozenset[str] = frozenset(
    leg.pp_reference for spec in TRIP_SPECS for leg in spec.consignments
)

# The walked trips share a start time so their phase timestamps are comparable
# on screen. Fixed, not now(): a seed that moves every run makes screenshots and
# bug reports impossible to compare.
_WALK_STARTED_AT = datetime(2026, 7, 30, 6, 0, tzinfo=UTC)
_MINUTES_PER_PHASE = 20

# Every seeded trip now carries a real schedule, because activation is gated on it:
# phase_service._reject_if_not_due refuses to start a trip before its scheduled day, and
# treats a trip with no schedule at all as not-yet-due. Seeding without these would make
# every demo trip permanently unstartable.
_OPERATING_TZ = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
# 06:00 local is the shift start these depots run to, and it puts the whole scheduled
# day comfortably ahead of whenever the seed is actually run.
_DEPARTURE_HOUR = 6
# Cape Town to Johannesburg is a long-haul day; the exact figure only has to be plausible
# and to order the stop slots sensibly.
_TRIP_DURATION_HOURS = 10


def _scheduled_departure_for(spec: _TripSpec) -> datetime:
    """When this trip is booked to leave.

    Split on whether the trip has already been walked, because the two cases need
    opposite things. A walked trip's evidence is timestamped from _WALK_STARTED_AT, so
    its schedule has to sit on that same fixed day or the trip claims to depart today
    while its own phase rows say last week. An UN-walked trip is the one a driver is
    meant to pick up and start, so it has to be scheduled for the day the seed is run —
    pin it to a fixed date and the demo stops working the next morning.
    """
    if spec.advance_through is not None:
        return _WALK_STARTED_AT

    today_local = datetime.now(_OPERATING_TZ).date()
    return datetime(
        today_local.year, today_local.month, today_local.day,
        _DEPARTURE_HOUR, 0, tzinfo=_OPERATING_TZ,
    ).astimezone(UTC)

# build_phase_plan always emits trip_creation first, at sequence 0 with a NULL stop.
# Named rather than spelled 0 inline because resolved_sequences() below turns
# on it and the reason it is special is not obvious from the literal.
TRIP_CREATION_SEQUENCE = 0


def resolved_sequences(spec: _TripSpec, plan_length: int) -> set[int]:
    """Sequence numbers a seeded trip starts life with already COMPLETED.

    ALWAYS includes trip_creation, whether or not the spec walks any further.
    Creating the trip IS P0's completion event, which is why create_trip() resolves
    it inline the moment its anchor succeeds (orchestration/trip_service.py) with
    the warning that names this exact bug: "Without this, h0 stays PENDING forever
    and _gate_and_load's 'all lower sequence_numbers resolved' check blocks every
    later phase permanently, since h0 is sequence 0 - the lowest possible."

    The seeder writes rows directly and so never reached that line. A seeded trip
    with P0 pending is un-walkable from both ends: the driver app derives P0 as the
    current phase, renders it as "Trip Created" with an empty step recipe and no way
    forward, and any completion the driver did manage to submit would 409 on the
    unresolved earlier phase. Seeded P0 stays UNANCHORED (anchor_status PENDING) -
    this resolves the ledger row, it does not fake a Hedera receipt, per this
    module's docstring.
    """
    if spec.advance_through is None:
        return {TRIP_CREATION_SEQUENCE}

    walk_limit = (
        plan_length - 1 if spec.advance_through == _ADVANCE_ALL else spec.advance_through
    )
    return {TRIP_CREATION_SEQUENCE} | set(range(walk_limit + 1))


def _position_for_event(
    event: PhaseEvent, *,
    stop_sequence_by_id: dict[uuid.UUID, int],
    precinct_by_sequence: dict[int, tuple[Decimal, Decimal]],
) -> tuple[Decimal, Decimal, Optional[bool]] | None:
    """Return the deterministic two-source position for one completed phase.

    The live corroboration path records a phone fix and a horse fix for every phase.
    ``in_transit`` is the one deliberate exception to stop semantics: its ledger row
    remains anchored to the departure stop, but the driver's completion action occurs
    at the next stop, so its seeded coordinates must describe that destination.
    """
    if event.trip_stop_id is None:
        return None

    stop_sequence = stop_sequence_by_id[event.trip_stop_id]
    coordinate_sequence = stop_sequence + 1 if PhaseType(event.phase_type) == PhaseType.IN_TRANSIT else stop_sequence
    coordinates = precinct_by_sequence.get(coordinate_sequence)
    if coordinates is None:
        return None

    return coordinates[0], coordinates[1], None if PhaseType(event.phase_type) == PhaseType.IN_TRANSIT else True


def _apply_seed_position_evidence(
    event: PhaseEvent, *, position: tuple[Decimal, Decimal, Optional[bool]] | None,
) -> None:
    """Populate both position sources on a completed seeded phase.

    Seeded coordinates are deterministic demo evidence, not a fabricated Hedera
    receipt. Keeping the capture instant equal to the phase completion time preserves
    the same temporal relationship the live path would expose to the dispatcher.
    """
    if position is None or event.completed_at is None:
        return

    lat, lng, geofence_confirmed = position
    event.driver_phone_lat = lat
    event.driver_phone_lng = lng
    event.driver_captured_at = event.completed_at
    event.horse_gps_lat = lat
    event.horse_gps_lng = lng
    event.pulsit_geofence_confirmed = geofence_confirmed


def _trailer_snapshot_for_event(
    event: PhaseEvent, *, trailer_id: uuid.UUID, pulsit_device_id: str,
    position: tuple[Decimal, Decimal, Optional[bool]] | None,
) -> TrailerGpsSnapshot | None:
    """Build the trailer-side corroboration row for one completed phase."""
    if position is None or event.completed_at is None:
        return None

    lat, lng, geofence_confirmed = position
    return TrailerGpsSnapshot(
        id=uuid.uuid4(),
        phase_event_id=event.id,
        trailer_id=trailer_id,
        pulsit_device_id=pulsit_device_id,
        lat=lat,
        lng=lng,
        captured_at=event.completed_at,
        geofence_confirmed=geofence_confirmed,
    )


def _apply_seed_scan_evidence(
    parcels: list[Parcel], *,
    scanned_out_at: Optional[datetime], scanned_in_at: Optional[datetime],
) -> None:
    """Stamp parcel rows when their seeded loading/unloading phases are resolved."""
    for parcel in parcels:
        if scanned_out_at is not None:
            parcel.pp_scan_out_at = scanned_out_at
            parcel.status = ParcelStatus.SCANNED_OUT
        if scanned_in_at is not None:
            parcel.pp_scan_in_at = scanned_in_at
            parcel.status = ParcelStatus.SCANNED_IN


def _fixture(pp_reference: str) -> PPWaybillResponse:
    """Return the PP fixture for a reference, failing loudly rather than half-seeding."""
    try:
        return MOCK_WAYBILLS[pp_reference]
    except KeyError:
        raise SystemExit(
            f"PP reference {pp_reference!r} is not in MOCK_WAYBILLS "
            "(app/integrations/parcel_perfect.py). The seeder must never invent a "
            "reference the wizard's PP lookup cannot resolve."
        ) from None


async def _reference(db: AsyncSession):
    """Fetch the seeded reference rows, failing loudly rather than half-seeding.

    Returns lists, not single rows: each demo trip gets its own driver and vehicles
    so the dispatcher's trip list is distinguishable at a glance and the per-trip
    Pulsit device snapshot is demonstrably per-trip.
    """
    users = (await db.execute(select(User).order_by(User.created_at))).scalars().all()
    drivers = (await db.execute(select(Driver).order_by(Driver.license_number))).scalars().all()
    horses = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.HORSE)
        .order_by(Vehicle.pulsit_device_id)
    )).scalars().all()
    trailers = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.TRAILER)
        .order_by(Vehicle.pulsit_device_id)
    )).scalars().all()
    precincts = {
        p.name: p for p in (await db.execute(select(Precinct))).scalars().all()
    }
    # Client attribution comes from the waybill's PP account number, exactly as
    # consignment_service resolves it on the live path - never hardcoded here.
    organizations = {
        o.pp_account_number: o
        for o in (await db.execute(select(Organization))).scalars().all()
        if o.pp_account_number
    }

    missing_precincts = [n for n in (_CPT, _BFN, _JHB) if n not in precincts]
    if not users or not drivers or not horses or not trailers or missing_precincts:
        raise SystemExit(
            "Reference data incomplete — run scripts/seed_demo.py first. "
            f"users={len(users)} drivers={len(drivers)} horses={len(horses)} "
            f"trailers={len(trailers)} missing precincts={missing_precincts}"
        )
    return users[0], list(drivers), list(horses), list(trailers), precincts, organizations


async def _seed_consignments(
    db: AsyncSession, *, trip: Trip, spec: _TripSpec,
    stops_by_sequence: dict[int, TripStop], organizations: dict[str, Organization],
) -> dict[str, list[Parcel]]:
    """Write one Consignment (+ its Parcel rows) per leg, sourced from the PP fixture.

    Returns the parcel rows keyed by pp_reference so the caller can stamp scan
    evidence only when the matching seeded loading/unloading phases are completed.

    Field-for-field this mirrors consignment_service.fetch_and_sync_consignment on
    the live path - same pp_raw_json shape, same parcel-count basis (len(tracks)),
    same client-org resolution through accnum. A seed that stores a different shape
    from the live path is a seed that hides bugs in whatever reads those columns.
    """
    parcels_by_reference: dict[str, list[Parcel]] = {}

    for leg in spec.consignments:
        waybill = _fixture(leg.pp_reference)
        pickup = stops_by_sequence[leg.pickup_sequence]
        delivery = stops_by_sequence[leg.delivery_sequence]
        parcel_count = len(waybill.tracks)
        parcel_rows: list[Parcel] = []

        client_org = organizations.get(waybill.details.accnum)
        declared_value = (
            Decimal(str(waybill.details.declared_value))
            if waybill.details.declared_value is not None
            else None
        )

        consignment = Consignment(
            id=uuid.uuid4(),
            trip_id=trip.id,
            parcel_perfect_reference=leg.pp_reference,
            client_organization_id=None if client_org is None else client_org.id,
            # Per-leg, not whole-route: this is what makes stop 2 a real cross-dock
            # point rather than a stop everything happens to pass through.
            origin_precinct_id=pickup.precinct_id,
            destination_precinct_id=delivery.precinct_id,
            pickup_stop_id=pickup.id,
            delivery_stop_id=delivery.id,
            declared_value=declared_value,
            parcel_count_expected=parcel_count,
            unit_count_expected=-(-parcel_count // _PARCELS_PER_PALLET),  # ceil
            pp_manifest_number=waybill.details.manifest,
            pp_raw_json=serialise_waybill(waybill),
        )
        db.add(consignment)
        await db.flush()

        for track in waybill.tracks:
            parcel = Parcel(
                id=uuid.uuid4(),
                consignment_id=consignment.id,
                barcode=track.trackno,
                status=ParcelStatus.PENDING,
            )
            db.add(parcel)
            parcel_rows.append(parcel)
        parcels_by_reference[leg.pp_reference] = parcel_rows

    await db.flush()
    return parcels_by_reference


def _apply_walk_evidence(
    event: PhaseEvent, *, spec: _TripSpec, stop_sequence: Optional[int],
    precinct: Optional[Precinct], loaded_at: dict[int, int], delivered_at: dict[int, int],
) -> None:
    """Write the evidence a driver would have captured completing this phase.

    Only fields the real completion path writes (orchestration/phase_service.py):
    activation captures phone GPS, loading the driver's visual count, departure the
    seal, arrival the seal as found at the gate, confirmation the delivered counts.
    Unloading writes nothing of its own here: the seal moved from it to arrival. Scan
    columns are applied after the ledger walk, once the seeder knows which loading and
    unloading rows are actually resolved.
    """
    phase_type = PhaseType(event.phase_type)

    if phase_type == PhaseType.ACTIVATION and precinct is not None:
        event.driver_phone_lat = precinct.latitude
        event.driver_phone_lng = precinct.longitude
        event.pulsit_geofence_confirmed = True
    elif phase_type == PhaseType.LOADING and stop_sequence is not None:
        event.driver_visual_count = loaded_at.get(stop_sequence, 0)
    elif phase_type == PhaseType.DEPARTURE:
        event.seal_number = spec.seal_number
    elif phase_type == PhaseType.ARRIVAL:
        # The seal as found at the gate. Intact and matching the departure seal is what
        # a clean trip looks like; the mismatch and compromised paths are exceptions,
        # not seeds.
        event.seal_number = spec.seal_number
        event.seal_condition = SealCondition.INTACT.value
    elif phase_type == PhaseType.CONFIRMATION and stop_sequence is not None:
        delivered = delivered_at.get(stop_sequence, 0)
        event.driver_visual_count = delivered
        event.parcel_count_destination = delivered


async def _seed_trip(
    db: AsyncSession, *, spec: _TripSpec, user: User, driver: Driver,
    horse: Vehicle, trailer: Vehicle, precincts: dict[str, Precinct],
    organizations: dict[str, Organization],
) -> Trip:
    """Create one trip: stops, trailer link, consignments, parcels, and the phase plan.

    A stop's routing role is derived from the consignment legs, exactly as
    create_trip derives it from the real consignment rows - the generator never
    sees a stop "type".

    Walking a trip (spec.advance_through) marks rows COMPLETED and writes their
    evidence directly. It deliberately does NOT go through advance_phase - see this
    module's docstring - so it performs no gating, anchoring or reconciliation.
    """
    key = _manifest_key_for(spec)
    departure_at = _scheduled_departure_for(spec)
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=spec.trip_reference,
        # Keyed on its PP manifest, as a trip created through the API would be.
        client_organization_id=organizations[key.issuer_account].id,
        pp_manifest_issuer_account=key.issuer_account,
        pp_manifest_origin_hub=key.origin_hub,
        pp_manifest_number=key.number,
        operator_organization_id=user.organization_id,
        driver_id=driver.id,
        horse_id=horse.id,
        status=TripStatus.CREATED,
        trip_type=TripType.LOADED.value,
        idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=departure_at,
        planned_arrival_at=departure_at + timedelta(hours=_TRIP_DURATION_HOURS),
        created_by_user_id=user.id,
    )
    db.add(trip)
    await db.flush()

    # Stop slots spread evenly across the planned run. They are not decoration: they are
    # the fallback activation gates on when planned_departure_at is null, so seeding them
    # exercises that path instead of leaving it only ever covered by tests.
    leg_count = max(len(spec.precinct_names) - 1, 1)
    hours_per_leg = _TRIP_DURATION_HOURS / leg_count
    stops = [
        TripStop(
            id=uuid.uuid4(), trip_id=trip.id, precinct_id=precincts[name].id, sequence=i + 1,
            slot_time=departure_at + timedelta(hours=hours_per_leg * i),
        )
        for i, name in enumerate(spec.precinct_names)
    ]
    db.add_all(stops)
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id,
                       pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db.flush()

    trip.origin_precinct_id = stops[0].precinct_id
    trip.destination_precinct_id = stops[-1].precinct_id
    by_sequence = {s.sequence: s for s in stops}

    parcels_by_reference = await _seed_consignments(
        db, trip=trip, spec=spec, stops_by_sequence=by_sequence, organizations=organizations,
    )
    parcel_counts = {
        pp_reference: len(parcels)
        for pp_reference, parcels in parcels_by_reference.items()
    }

    # Per-stop cargo movement, derived from the legs - the same derivation the phase
    # plan itself runs on, so the counts a driver "recorded" always agree with the
    # plan's shape rather than being a second, independently-invented number.
    loaded_at: dict[int, int] = {}
    delivered_at: dict[int, int] = {}
    for leg in spec.consignments:
        count = parcel_counts[leg.pp_reference]
        loaded_at[leg.pickup_sequence] = loaded_at.get(leg.pickup_sequence, 0) + count
        delivered_at[leg.delivery_sequence] = delivered_at.get(leg.delivery_sequence, 0) + count

    plan = build_phase_plan([
        PlanStop(sequence=s.sequence, picks_up=s.sequence in loaded_at,
                 drops_off=s.sequence in delivered_at)
        for s in stops
    ])
    for planned in plan:
        db.add(PhaseEvent(
            id=uuid.uuid4(),
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None
            else by_sequence[planned.stop_sequence].id,
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.PENDING,
            anchor_status=(AnchorStatus.PENDING if planned.phase_type in ANCHORED_PHASES
                           else AnchorStatus.NOT_REQUIRED),
        ))

    # Cache seeded from the ledger, never independently: the current phase is the
    # lowest-sequence row that is not resolved.
    events = sorted(
        (await db.execute(
            select(PhaseEvent).where(PhaseEvent.trip_id == trip.id)
        )).scalars().all(),
        key=lambda e: e.sequence_number,
    )
    stop_sequence_by_id = {s.id: s.sequence for s in stops}
    precinct_by_stop_id = {s.id: precincts[name]
                           for s, name in zip(stops, spec.precinct_names, strict=True)}
    precinct_by_sequence = {
        s.sequence: (precincts[name].latitude, precincts[name].longitude)
        for s, name in zip(stops, spec.precinct_names, strict=True)
    }

    # Which rows start resolved is a decision, not a loop bound - resolved_sequences()
    # owns it so the "P0 is always complete" rule is unit-testable without a database
    # (tests/unit/test_seed_fixtures.py) rather than buried in this walk. Note this
    # is now unconditional: even a spec with advance_through=None resolves P0.
    resolved = resolved_sequences(spec, len(events))
    for event in events:
        if event.sequence_number not in resolved:
            continue
        event.status = PhaseStatus.COMPLETED
        event.completed_at = (
            _WALK_STARTED_AT + timedelta(minutes=event.sequence_number * _MINUTES_PER_PHASE)
        )
        # A no-op for trip_creation - it has no phase-specific evidence branch, which
        # is the point: P0 is resolved by the trip existing, not by driver capture.
        _apply_walk_evidence(
            event, spec=spec,
            stop_sequence=None if event.trip_stop_id is None
            else stop_sequence_by_id[event.trip_stop_id],
            precinct=None if event.trip_stop_id is None
            else precinct_by_stop_id[event.trip_stop_id],
            loaded_at=loaded_at, delivered_at=delivered_at,
        )

        position = _position_for_event(
            event,
            stop_sequence_by_id=stop_sequence_by_id,
            precinct_by_sequence=precinct_by_sequence,
        )
        _apply_seed_position_evidence(event, position=position)
        snapshot = _trailer_snapshot_for_event(
            event,
            trailer_id=trailer.id,
            pulsit_device_id=trailer.pulsit_device_id,
            position=position,
        )
        if snapshot is not None:
            db.add(snapshot)

    completed_by_stop_and_phase = {
        (
            stop_sequence_by_id[event.trip_stop_id],
            PhaseType(event.phase_type),
        ): event
        for event in events
        if event.status == PhaseStatus.COMPLETED and event.trip_stop_id is not None
    }
    for leg in spec.consignments:
        parcels = parcels_by_reference[leg.pp_reference]
        loading_event = completed_by_stop_and_phase.get((leg.pickup_sequence, PhaseType.LOADING))
        unloading_event = completed_by_stop_and_phase.get((leg.delivery_sequence, PhaseType.UNLOADING))
        _apply_seed_scan_evidence(
            parcels,
            scanned_out_at=None if loading_event is None else loading_event.completed_at,
            scanned_in_at=None if unloading_event is None else unloading_event.completed_at,
        )
        if loading_event is not None:
            loading_event.parcel_count_origin = len(parcels)

    current = next((e for e in events if e.status != PhaseStatus.COMPLETED), None)
    # event.phase_type comes back as a plain str after the bulk PhaseEvent insert
    # (insertmanyvalues repopulates every column from the RETURNING row, not just
    # server-generated ones) — coerce before .value, matching the same guard in
    # complete_phase (phase_service.py: `actual = PhaseType(event.phase_type)`).
    trip.current_phase = PhaseType(current.phase_type).value if current is not None else None
    trip.current_stop = (
        None if current is None or current.trip_stop_id is None
        else stop_sequence_by_id[current.trip_stop_id]
    )
    if current is None:
        # Every phase resolved. Mirrors recompute_position's closing rule rather than
        # inventing a second definition of "closed".
        trip.status = TripStatus.CLOSED
        trip.closed_at = events[-1].completed_at
    elif spec.advance_through is not None:
        # Walked but not finished - U9's derived-active state.
        trip.status = TripStatus.ACTIVE

    departure_times = [
        event.completed_at for event in events
        if PhaseType(event.phase_type) == PhaseType.DEPARTURE
        and event.status == PhaseStatus.COMPLETED
        and event.completed_at is not None
    ]
    if departure_times:
        trip.actual_departure_at = min(departure_times)

    in_transit_events = [
        event for event in events
        if PhaseType(event.phase_type) == PhaseType.IN_TRANSIT
    ]
    if in_transit_events and in_transit_events[-1].status == PhaseStatus.COMPLETED:
        trip.actual_arrival_at = in_transit_events[-1].completed_at

    await db.flush()

    total_parcels = sum(parcel_counts.values())
    print(f"  {spec.trip_reference:<22} {len(plan):>2} phases  ({len(stops)} stops, "
          f"{len(spec.consignments)} consignments, {total_parcels} parcels)  "
          f"{trip.status.value if isinstance(trip.status, TripStatus) else trip.status}")
    return trip


async def seed() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            user, drivers, horses, trailers, precincts, organizations = await _reference(db)

            for i, spec in enumerate(TRIP_SPECS):
                # Modulo, not a hard requirement of one vehicle per trip: the seed
                # must still run against a reference set smaller than TRIP_SPECS
                # (e.g. a database seeded before seed_demo.py grew its fleet).
                await _seed_trip(
                    db, spec=spec, user=user,
                    driver=drivers[i % len(drivers)],
                    horse=horses[i % len(horses)],
                    trailer=trailers[i % len(trailers)],
                    precincts=precincts, organizations=organizations,
                )

            await db.commit()
            print("Trip seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
