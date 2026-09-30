"""check_trip_on_road against a real test DB and the Pulsit mock (fake Redis store)."""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.realtime import EventSeverity, RealtimeKind
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, IdvsStatus, OrganizationType,
    PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations import pulsit as pulsit_module
from app.integrations.pulsit import get_pulsit_client
from app.orchestration.road_check_service import check_trip_on_road
from tests.conftest import FakeMockStateStore

_ORIGIN = (Decimal("-33.9249000"), Decimal("18.4241000"))
_DEST = (Decimal("-33.7342000"), Decimal("18.9621000"))
_MID = (Decimal("-33.8295500"), Decimal("18.6931000"))
_FAR_FROM_MID = (Decimal("-33.8795500"), Decimal("18.6931000"))  # ~5.6 km south of _MID
_PLAN = [
    (PhaseType.TRIP_CREATION, None), (PhaseType.ACTIVATION, 0), (PhaseType.LOADING, 0),
    (PhaseType.DEPARTURE, 0), (PhaseType.IN_TRANSIT, 0), (PhaseType.ARRIVAL, 1),
    (PhaseType.UNLOADING, 1), (PhaseType.CONFIRMATION, 1),
]


@pytest.fixture(autouse=True)
def mock_pulsit(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(pulsit_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    return fake


async def _seed(db_session, *, completed_through: PhaseType) -> dict:
    """A single-leg trip with one trailer; every phase up to `completed_through` completed.

    A plain function, not a fixture, so test_dev_tracker can import and reuse it.
    """
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:6]}@t.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:4]}",
    )
    horse = Vehicle(id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
                    registration="CA 100-000", pulsit_device_id=f"H-{uuid.uuid4().hex[:8]}")
    trailer = Vehicle(id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.TRAILER,
                      registration="TRL 222", pulsit_device_id=f"T-{uuid.uuid4().hex[:8]}")
    origin = Precinct(id=uuid.uuid4(), name="Cape Town DC", principal_organization_id=org.id,
                      latitude=_ORIGIN[0], longitude=_ORIGIN[1], geofence_radius_metres=200)
    dest = Precinct(id=uuid.uuid4(), name="Paarl Depot", principal_organization_id=org.id,
                    latitude=_DEST[0], longitude=_DEST[1], geofence_radius_metres=200)
    db_session.add_all([user, driver, horse, trailer, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0),
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=1),
    ]
    db_session.add_all(stops)
    db_session.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id, pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db_session.flush()
    phases: dict[PhaseType, PhaseEvent] = {}
    done = True
    for sequence, (phase_type, stop_index) in enumerate(_PLAN):
        phases[phase_type] = PhaseEvent(
            id=uuid.uuid4(), trip_id=trip.id, phase_type=phase_type, sequence_number=sequence,
            trip_stop_id=stops[stop_index].id if stop_index is not None else None,
            status=PhaseStatus.COMPLETED if done else PhaseStatus.PENDING,
        )
        if phase_type == completed_through:
            done = False
    db_session.add_all(phases.values())
    await db_session.flush()
    return {"trip": trip, "horse": horse, "trailer": trailer, "phases": phases, "user": user}


async def _stage(trip: Trip, device_id: str, position: tuple[Decimal, Decimal] | None) -> None:
    client = get_pulsit_client(organization_id=trip.operator_organization_id)
    if position is None:
        await client.stage_no_fix(device_id)
    else:
        await client.stage_position(device_id, lat=position[0], lng=position[1])


async def _exceptions(db_session, trip_id: uuid.UUID) -> list[TripException]:
    return list((await db_session.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )).scalars().all())


async def test_uncoupled_trailer_on_road_records_one_system_exception(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    result = await check_trip_on_road(db_session, trip=seed["trip"])

    rows = await _exceptions(db_session, seed["trip"].id)
    assert [r.exception_type for r in rows] == [ExceptionType.TRAILER_SEPARATED_IN_TRANSIT]
    row = rows[0]
    assert row.source == ExceptionSource.SYSTEM
    assert row.severity == ExceptionSeverity.CRITICAL
    assert row.phase_event_id == seed["phases"][PhaseType.IN_TRANSIT].id
    assert row.vehicle_id == seed["trailer"].id
    assert (row.gps_lat, row.gps_lng) == _FAR_FROM_MID
    assert len(result.recorded) == 1 and result.already_recorded == []


async def test_running_the_check_twice_records_once(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    await check_trip_on_road(db_session, trip=seed["trip"])
    second = await check_trip_on_road(db_session, trip=seed["trip"])

    assert len(await _exceptions(db_session, seed["trip"].id)) == 1
    assert second.recorded == [] and len(second.already_recorded) == 1


async def test_recorded_finding_publishes_critical_realtime_event(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    await check_trip_on_road(db_session, trip=seed["trip"])

    events = [e for _org, e in db_session.info.get("realtime_outbox", []) if e.kind == RealtimeKind.EXCEPTION_RAISED]
    assert len(events) == 1
    assert events[0].severity == EventSeverity.CRITICAL


async def test_truck_away_from_origin_before_departure_is_recorded_on_departure(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.LOADING)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _MID)

    await check_trip_on_road(db_session, trip=seed["trip"])

    rows = await _exceptions(db_session, seed["trip"].id)
    assert [r.exception_type for r in rows] == [ExceptionType.MOVED_BEFORE_DEPARTURE]
    assert rows[0].phase_event_id == seed["phases"][PhaseType.DEPARTURE].id


async def test_closed_trip_is_skipped(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.CONFIRMATION)
    seed["trip"].status = TripStatus.CLOSED
    await db_session.flush()

    result = await check_trip_on_road(db_session, trip=seed["trip"])

    assert result.skipped_reason is not None
    assert await _exceptions(db_session, seed["trip"].id) == []
