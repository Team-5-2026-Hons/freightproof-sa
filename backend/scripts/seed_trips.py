"""Seed the four demo trips: single-leg, cross-dock, in-flight, and closed.

The 11-row cross-dock trip is the point: it is the shape the old
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
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus, IdvsStatus, ParcelStatus, PhaseStatus, PhaseType, TripStatus, TripType, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations.parcel_perfect import MOCK_WAYBILLS, PPWaybillResponse
from app.orchestration.consignment_service import serialise_waybill
from app.orchestration.phase_plan import ANCHORED_PHASES, PlanStop, build_phase_plan

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
    order_number: str
    precinct_names: tuple[str, ...]
    consignments: tuple[_ConsignmentLeg, ...]
    # Format enforced by schemas/phases.py _SEAL_PATTERN - XX-####.
    seal_number: str
    # Mark rows up to and including this sequence COMPLETED. _ADVANCE_ALL walks the
    # whole plan, which closes the trip.
    advance_through: Optional[int | Literal["all"]] = None


TRIP_SPECS: tuple[_TripSpec, ...] = (
    # Single-leg: the degenerate case of the multi-stop plan. 7 rows.
    _TripSpec(
        trip_reference="FP-DEMO-SINGLE-0001",
        order_number="ORD-DEMO-SINGLE-0001",
        precinct_names=(_CPT, _JHB),
        consignments=(_ConsignmentLeg("MOCKWB0001", 1, 2),),
        seal_number="FP-4471",
    ),
    # Cross-dock: stop 2 is both a drop-off and a pick-up. 11 rows.
    _TripSpec(
        trip_reference="FP-DEMO-XDOCK-0001",
        order_number="ORD-DEMO-XDOCK-0001",
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
    # at `unloading` at stop 2. This is the trip a reviewer is walked through: it is
    # the only seed on which the derived-active marker, the coarse `active` status
    # filter, and a real seal + parcel count are all visible at once.
    _TripSpec(
        trip_reference="FP-DEMO-ACTIVE-0001",
        order_number="ORD-DEMO-ACTIVE-0001",
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
        order_number="ORD-DEMO-CLOSED-0001",
        precinct_names=(_CPT, _JHB),
        consignments=(_ConsignmentLeg("MOCKWB0008", 1, 2),),
        seal_number="FP-7204",
        advance_through=_ADVANCE_ALL,
    ),
)

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
) -> dict[str, int]:
    """Write one Consignment (+ its Parcel rows) per leg, sourced from the PP fixture.

    Returns the parcel count keyed by pp_reference so the caller can derive the
    per-stop counts a driver would actually have recorded.

    Field-for-field this mirrors consignment_service.fetch_and_sync_consignment on
    the live path - same pp_raw_json shape, same parcel-count basis (len(tracks)),
    same client-org resolution through accnum. A seed that stores a different shape
    from the live path is a seed that hides bugs in whatever reads those columns.
    """
    parcel_counts: dict[str, int] = {}

    for leg in spec.consignments:
        waybill = _fixture(leg.pp_reference)
        pickup = stops_by_sequence[leg.pickup_sequence]
        delivery = stops_by_sequence[leg.delivery_sequence]
        parcel_count = len(waybill.tracks)
        parcel_counts[leg.pp_reference] = parcel_count

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
            db.add(Parcel(
                id=uuid.uuid4(),
                consignment_id=consignment.id,
                barcode=track.trackno,
                status=ParcelStatus.PENDING,
            ))

    await db.flush()
    return parcel_counts


def _apply_walk_evidence(
    event: PhaseEvent, *, spec: _TripSpec, stop_sequence: Optional[int],
    precinct: Optional[Precinct], loaded_at: dict[int, int], delivered_at: dict[int, int],
) -> None:
    """Write the evidence a driver would have captured completing this phase.

    Only fields the real completion path writes (orchestration/phase_service.py):
    activation captures phone GPS, loading the driver's visual count, departure the
    seal, unloading the seal re-read at destination, confirmation the delivered
    counts. parcel_count_origin is deliberately NOT set - nothing on the live path
    writes it, and a seed that populates a column the application never fills would
    make a dead column look load-bearing.
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
    elif phase_type == PhaseType.UNLOADING:
        # The seal read at destination. Matching the departure seal is what a clean
        # trip looks like; the mismatch path is an exception, not a seed.
        event.seal_number = spec.seal_number
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
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=spec.trip_reference,
        order_number=spec.order_number,
        operator_organization_id=user.organization_id,
        driver_id=driver.id,
        horse_id=horse.id,
        status=TripStatus.CREATED,
        trip_type=TripType.LOADED.value,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db.add(trip)
    await db.flush()

    stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precincts[name].id, sequence=i + 1)
        for i, name in enumerate(spec.precinct_names)
    ]
    db.add_all(stops)
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id,
                       pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db.flush()

    trip.origin_precinct_id = stops[0].precinct_id
    trip.destination_precinct_id = stops[-1].precinct_id
    by_sequence = {s.sequence: s for s in stops}

    parcel_counts = await _seed_consignments(
        db, trip=trip, spec=spec, stops_by_sequence=by_sequence, organizations=organizations,
    )

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

    if spec.advance_through is not None:
        walk_limit = (
            events[-1].sequence_number if spec.advance_through == _ADVANCE_ALL
            else spec.advance_through
        )
        for event in events:
            if event.sequence_number > walk_limit:
                break
            event.status = PhaseStatus.COMPLETED
            event.completed_at = (
                _WALK_STARTED_AT + timedelta(minutes=event.sequence_number * _MINUTES_PER_PHASE)
            )
            _apply_walk_evidence(
                event, spec=spec,
                stop_sequence=None if event.trip_stop_id is None
                else stop_sequence_by_id[event.trip_stop_id],
                precinct=None if event.trip_stop_id is None
                else precinct_by_stop_id[event.trip_stop_id],
                loaded_at=loaded_at, delivered_at=delivered_at,
            )

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
        # Every phase resolved. Mirrors recompute_position's closing rule (§2.4
        # steps 8-9) rather than inventing a second definition of "closed".
        trip.status = TripStatus.CLOSED
        trip.closed_at = events[-1].completed_at
    elif spec.advance_through is not None:
        # Walked but not finished - U9's derived-active state.
        trip.status = TripStatus.ACTIVE
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
