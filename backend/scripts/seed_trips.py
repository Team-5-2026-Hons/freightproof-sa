"""Seed one single-leg (7-phase) and one cross-dock (11-phase) trip.

The 11-row trip is the point: it is the shape the old
UNIQUE(trip_id, handshake_type) constraint made unrepresentable, and it is what a
reviewer is walked through at the demo. Consignments A (stop 1->3), B (1->2) and
C (2->3) make stop 2 both a drop-off and a pick-up.

Deliberately writes rows directly rather than calling create_trip(): P0 anchoring is
fail-closed, so create_trip() would put a Hedera testnet round-trip in the middle of
a seed. Seeded trips therefore have journey_lock_hash = NULL and an unanchored P0 —
real anchoring is exercised by POST /trips, not by this script.

Run scripts/dev_reset_lifecycle.py first if the database already has trips.

Usage:
    cd backend
    PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus, IdvsStatus, PhaseStatus, PhaseType, TripStatus, TripType, VehicleType,
)
from app.db.models.organisations import Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_plan import ANCHORED_PHASES, PlanStop, build_phase_plan

_CPT = "Cape Town Depot (Epping)"
_BFN = "Bloemfontein Depot (Hamilton)"
_JHB = "Johannesburg Depot (Linbro)"
# Format enforced by schemas/phases.py _SEAL_PATTERN — XX-####.
_DEMO_SEAL = "FP-4471"


async def _reference(db: AsyncSession):
    """Fetch the seeded reference rows, failing loudly rather than half-seeding."""
    user = (await db.execute(select(User).order_by(User.created_at))).scalars().first()
    driver = (await db.execute(select(Driver).order_by(Driver.created_at))).scalars().first()
    horse = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.HORSE)
    )).scalars().first()
    trailer = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.TRAILER)
    )).scalars().first()
    precincts = {
        p.name: p for p in (await db.execute(select(Precinct))).scalars().all()
    }
    missing = [n for n in (_CPT, _BFN, _JHB) if n not in precincts]
    if user is None or driver is None or horse is None or trailer is None or missing:
        raise SystemExit(
            "Reference data incomplete — run scripts/seed_demo.py first. "
            f"missing precincts={missing}"
        )
    return user, driver, horse, trailer, precincts


async def _seed_trip(
    db: AsyncSession, *, reference, trip_reference: str, order_number: str,
    precinct_names: list[str], consignment_legs: list[tuple[str, int, int]],
    advance_through: int | None = None,
) -> Trip:
    """Create one trip: stops, trailer link, consignments, and the full phase plan.

    `consignment_legs` is [(pp_reference, pickup_stop_seq, delivery_stop_seq), ...].
    A stop's routing role is derived from these, exactly as Stage 2.1 will derive it
    from the real consignment rows — the generator never sees a stop "type".

    `advance_through` marks every row up to and including that sequence_number as
    COMPLETED and sets the trip ACTIVE (U9). It exists so the dispatcher has an
    in-flight trip to render: both other seeds are all-PENDING, which never shows a
    derived-active marker on screen. It deliberately does NOT go through
    advance_phase — see this module's docstring — so it writes evidence fields
    directly and performs no gating, anchoring or reconciliation.
    """
    user, driver, horse, trailer, precincts = reference

    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=trip_reference,
        order_number=order_number,
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
        for i, name in enumerate(precinct_names)
    ]
    db.add_all(stops)
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id,
                       pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db.flush()

    trip.origin_precinct_id = stops[0].precinct_id
    trip.destination_precinct_id = stops[-1].precinct_id
    by_sequence = {s.sequence: s for s in stops}

    picks_up: set[int] = set()
    drops_off: set[int] = set()
    for pp_reference, pickup_seq, delivery_seq in consignment_legs:
        db.add(Consignment(
            id=uuid.uuid4(), trip_id=trip.id,
            parcel_perfect_reference=pp_reference,
            client_organization_id=None,
            origin_precinct_id=by_sequence[pickup_seq].precinct_id,
            destination_precinct_id=by_sequence[delivery_seq].precinct_id,
            pickup_stop_id=by_sequence[pickup_seq].id,
            delivery_stop_id=by_sequence[delivery_seq].id,
            parcel_count_expected=12,
        ))
        picks_up.add(pickup_seq)
        drops_off.add(delivery_seq)
    await db.flush()

    plan = build_phase_plan([
        PlanStop(sequence=s.sequence, picks_up=s.sequence in picks_up,
                 drops_off=s.sequence in drops_off)
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

    if advance_through is not None:
        walked_at = datetime(2026, 7, 30, 6, 0, tzinfo=UTC)
        for event in events:
            if event.sequence_number > advance_through:
                break
            event.status = PhaseStatus.COMPLETED
            event.completed_at = walked_at + timedelta(minutes=event.sequence_number * 20)
            # Evidence the dispatcher's panels actually read, written only where the
            # phase model says it is captured: the seal at departure (D7/§2.6), the
            # driver's count at loading. Nothing here is anchored.
            if event.phase_type == PhaseType.DEPARTURE:
                event.seal_number = _DEMO_SEAL
            elif event.phase_type == PhaseType.LOADING:
                event.driver_visual_count = 12
                event.parcel_count_origin = 12
        trip.status = TripStatus.ACTIVE

    current = next((e for e in events if e.status != PhaseStatus.COMPLETED), None)
    # event.phase_type comes back as a plain str after the bulk PhaseEvent insert
    # (insertmanyvalues repopulates every column from the RETURNING row, not just
    # server-generated ones) — coerce before .value, matching the same guard in
    # complete_phase (phase_service.py: `actual = PhaseType(event.phase_type)`).
    trip.current_phase = PhaseType(current.phase_type).value if current is not None else None
    trip.current_stop = (
        None if current is None or current.trip_stop_id is None
        else next(s.sequence for s in stops if s.id == current.trip_stop_id)
    )
    await db.flush()

    print(f"  {trip_reference:<22} {len(plan):>2} phases  ({len(stops)} stops)"
          f"{'' if advance_through is None else f'  advanced through seq {advance_through}'}")
    return trip


async def seed() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            reference = await _reference(db)

            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-SINGLE-0001", order_number="ORD-DEMO-SINGLE-0001",
                precinct_names=[_CPT, _JHB],
                consignment_legs=[("MOCKWB0001", 1, 2)],
            )
            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-XDOCK-0001", order_number="ORD-DEMO-XDOCK-0001",
                precinct_names=[_CPT, _BFN, _JHB],
                consignment_legs=[
                    ("MOCKWB0002", 1, 3),   # A: straight through
                    ("MOCKWB0003", 1, 2),   # B: dropped at the hub
                    ("MOCKWB0004", 2, 3),   # C: collected at the hub
                ],
            )
            # The in-flight trip. Same 3-stop cross-dock shape as XDOCK (11 rows),
            # walked through seq 4 — trip_creation, activation, loading, departure
            # and the leg-1 in_transit are done; the trip sits at `unloading` at
            # stop 2. This is the trip a reviewer is walked through: it is the only
            # seed on which the derived-active marker, the coarse `active` status
            # filter, and a real seal + parcel count are all visible at once.
            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-ACTIVE-0001", order_number="ORD-DEMO-ACTIVE-0001",
                precinct_names=[_CPT, _BFN, _JHB],
                consignment_legs=[
                    ("MOCKWB0005", 1, 3),   # A: straight through
                    ("MOCKWB0006", 1, 2),   # B: dropped at the hub
                    ("MOCKWB0007", 2, 3),   # C: collected at the hub
                ],
                advance_through=4,
            )
            await db.commit()
            print("Trip seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
