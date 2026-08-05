"""Stage 3 emit tests — the three orchestration write paths enqueue the right realtime
event onto the request's outbox.

DB-backed (uses the rolled-back db_session), no Hedera and no Redis: _finish_phase and
raise_exception neither anchor nor publish — publishing is the after_commit hook's job,
which these assert by reading the outbox left on the session (session.info), exactly the
list the hook would drain on commit. The discard-on-rollback half of D9 is covered in
tests/unit/test_realtime.py.
"""

import uuid

from app.core.realtime import RealtimeKind
from app.db.models.enums import (
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    PhaseStatus,
    PhaseType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.exception_service import raise_exception
from app.orchestration.phase_service import _finish_phase

_OUTBOX_KEY = "realtime_outbox"

# The full single-leg plan, in sequence order — mirrors what create_trip writes.
_PLAN = [
    ("trip_creation", PhaseType.TRIP_CREATION, 0, None),
    ("activation", PhaseType.ACTIVATION, 1, 0),
    ("loading", PhaseType.LOADING, 2, 0),
    ("departure", PhaseType.DEPARTURE, 3, 0),
    ("in_transit", PhaseType.IN_TRANSIT, 4, 0),
    ("unloading", PhaseType.UNLOADING, 5, 1),
    ("confirmation", PhaseType.CONFIRMATION, 6, 1),
]


async def _seed_trip(db_session) -> tuple[Trip, Driver, dict[str, PhaseEvent]]:
    """Seed one single-leg trip + its full pending phase plan (trip_creation completed)."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="Origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="Dest", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-EMIT-1", order_number="ORD-EMIT-1",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stops = {
        0: TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0),
        1: TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1),
    }
    db_session.add_all(stops.values())
    await db_session.flush()

    phases: dict[str, PhaseEvent] = {}
    for name, ptype, seq, stop_seq in _PLAN:
        phases[name] = PhaseEvent(
            trip_id=trip.id, phase_type=ptype, sequence_number=seq,
            trip_stop_id=None if stop_seq is None else stops[stop_seq].id,
            status=PhaseStatus.COMPLETED if name == "trip_creation" else PhaseStatus.PENDING,
        )
    db_session.add_all(phases.values())
    await db_session.flush()

    return trip, driver, phases


def _outbox(db_session) -> list:
    return db_session.info.get(_OUTBOX_KEY, [])


async def test_finishing_a_non_final_phase_enqueues_phase_completed(db_session):
    trip, _driver, phases = await _seed_trip(db_session)
    # Activation done, everything after it still pending → the trip stays open.
    phases["activation"].status = PhaseStatus.COMPLETED
    await db_session.flush()

    await _finish_phase(
        db_session, trip=trip, event=phases["activation"], idempotency_key=str(uuid.uuid4()),
    )

    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.PHASE_COMPLETED
    assert event.id == trip.id
    assert event.resource == "trip"


async def test_finishing_the_last_phase_enqueues_trip_closed(db_session):
    trip, _driver, phases = await _seed_trip(db_session)
    # Every phase resolved → recompute_position closes the trip, so the ping is trip_closed.
    for phase in phases.values():
        phase.status = PhaseStatus.COMPLETED
    await db_session.flush()

    await _finish_phase(
        db_session, trip=trip, event=phases["confirmation"], idempotency_key=str(uuid.uuid4()),
    )

    assert trip.status == TripStatus.CLOSED  # guards the branch's precondition
    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.TRIP_CLOSED
    assert event.id == trip.id


async def test_raising_an_exception_enqueues_exception_raised(db_session):
    trip, driver, _phases = await _seed_trip(db_session)

    await raise_exception(
        db_session, trip_id=trip.id, driver_id=driver.id,
        exception_type=ExceptionType.PANIC_BUTTON, description="Hijack in progress",
        supporting_artifact_id=None,
    )

    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.EXCEPTION_RAISED
    assert event.id == trip.id
