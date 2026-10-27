"""FP-83 C2: crew availability once a trip's driver can change.

busy_crew_in_window keeps its public contract; what changes is who a live trip occupies (the
current driver, not the original) and that a pending takeover reserves the incoming driver.
All times are fixed instants and `now` is passed explicitly, so the half-open boundaries are
asserted exactly.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import TripActivationBlockedError
from app.db.models.enums import IdvsStatus, TripStatus, VehicleType
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.orchestration.phases.scheduling import _claim_crew_for_activation
from app.orchestration.trips.availability import CrewFilter, TimeWindow, busy_crew_in_window
from app.schemas.availability import CrewResourceType
from tests.conftest import auth_header, make_token
from tests.integration._driver_substitution_world import (
    SubWorld, add_pending, build_world, complete_handover,
)

BASE = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)


async def _busy(db: AsyncSession, w: SubWorld, driver_id: uuid.UUID | None, start: datetime, end: datetime, *, now: datetime):
    crew = CrewFilter(driver_id=driver_id) if driver_id is not None else CrewFilter()
    return await busy_crew_in_window(
        db, organization_id=w.org_id, window=TimeWindow(start, end), now=now, crew=crew,
    )


async def _world(db: AsyncSession, *, arrival: datetime | None = BASE + 8 * HOUR) -> SubWorld:
    return await build_world(db, departure=BASE, arrival=arrival)



async def test_pending_takeover_reserves_the_incoming_driver_from_expected_at(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)
    now = BASE + HOUR

    before = await _busy(db_session, w, w.b, BASE + 2 * HOUR, BASE + 3 * HOUR, now=now)
    touching_start = await _busy(db_session, w, w.b, BASE + 3 * HOUR, BASE + 4 * HOUR, now=now)
    inside = await _busy(db_session, w, w.b, BASE + 4 * HOUR, BASE + 5 * HOUR, now=now)

    assert before == [] and touching_start == []
    assert [(e.resource_type, e.resource_id) for e in inside] == [(CrewResourceType.DRIVER, w.b)]
    assert inside[0].busy_from == BASE + 4 * HOUR
    assert inside[0].busy_until == BASE + 8 * HOUR


async def test_reservation_ends_exactly_at_the_trips_planned_end(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)
    now = BASE + HOUR

    last_minute = await _busy(db_session, w, w.b, BASE + 8 * HOUR - timedelta(minutes=1), BASE + 9 * HOUR, now=now)
    at_end = await _busy(db_session, w, w.b, BASE + 8 * HOUR, BASE + 9 * HOUR, now=now)

    assert len(last_minute) == 1
    assert at_end == []


async def test_open_ended_trip_keeps_the_reservation_open_ended(db_session: AsyncSession):
    w = await build_world(db_session, departure=BASE, arrival=None)
    trip = await db_session.get(Trip, w.trip_id)
    assert trip is not None
    trip.planned_arrival_at = None
    await db_session.flush()
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)

    far_future = await _busy(db_session, w, w.b, BASE + 400 * HOUR, BASE + 401 * HOUR, now=BASE + HOUR)

    assert len(far_future) == 1
    assert far_future[0].busy_until is None


async def test_overrun_trip_keeps_the_reservation_until_the_trip_ends(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)
    now = BASE + 9 * HOUR

    incoming = await _busy(db_session, w, w.b, BASE + 50 * HOUR, BASE + 51 * HOUR, now=now)
    outgoing = await _busy(db_session, w, w.a, BASE + 50 * HOUR, BASE + 51 * HOUR, now=now)

    assert len(incoming) == 1 and incoming[0].busy_until is None
    assert len(outgoing) == 1 and outgoing[0].busy_until is None


async def test_overdue_reservation_starts_no_later_than_now_and_stays_effective(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 2 * HOUR)
    now = BASE + 3 * HOUR

    at_expected = await _busy(db_session, w, w.b, BASE + 2 * HOUR, BASE + 2 * HOUR + timedelta(minutes=30), now=now)
    right_now = await _busy(db_session, w, w.b, now, now + HOUR, now=now)
    next_week = await _busy(db_session, w, w.b, BASE + 150 * HOUR, BASE + 151 * HOUR, now=now)

    assert len(at_expected) == 1 and len(right_now) == 1
    assert at_expected[0].busy_from <= now
    assert len(next_week) == 1 and next_week[0].busy_until is None


async def test_outgoing_driver_stays_occupied_until_the_transfer_is_effective(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)

    outgoing = await _busy(db_session, w, w.a, BASE + 5 * HOUR, BASE + 6 * HOUR, now=BASE + HOUR)

    assert [e.resource_id for e in outgoing] == [w.a]


async def test_completed_handover_frees_the_former_driver_and_occupies_the_new_one(db_session: AsyncSession):
    w = await _world(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    now = BASE + 5 * HOUR

    former = await _busy(db_session, w, w.a, BASE + 5 * HOUR, BASE + 6 * HOUR, now=now)
    current = await _busy(db_session, w, w.b, BASE + 5 * HOUR, BASE + 6 * HOUR, now=now)

    assert former == []
    assert [e.resource_id for e in current] == [w.b]


async def test_cancelled_or_replaced_request_releases_the_reservation(db_session: AsyncSession):
    w = await _world(db_session)
    request = await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)
    now = BASE + HOUR
    assert len(await _busy(db_session, w, w.b, BASE + 5 * HOUR, BASE + 6 * HOUR, now=now)) == 1

    request.state = "cancelled"
    request.terminal_at = now
    replacement = await add_pending(db_session, w, outgoing=w.a, incoming=w.c, expected_at=BASE + 4 * HOUR)

    released = await _busy(db_session, w, w.b, BASE + 5 * HOUR, BASE + 6 * HOUR, now=now)
    taken = await _busy(db_session, w, w.c, BASE + 5 * HOUR, BASE + 6 * HOUR, now=now)

    assert released == []
    assert [e.resource_id for e in taken] == [w.c]
    assert replacement.state == "pending"


async def test_second_trip_reserving_the_same_driver_sees_the_first_reservation(db_session: AsyncSession):
    first = await _world(db_session)
    await add_pending(db_session, first, outgoing=first.a, incoming=first.b, expected_at=BASE + 4 * HOUR)

    clash = await _busy(db_session, first, first.b, BASE + 5 * HOUR, BASE + 6 * HOUR, now=BASE + HOUR)

    assert [e.trip_id for e in clash] == [first.trip_id]
    assert clash[0].resource_type == CrewResourceType.DRIVER


async def test_fleet_view_lists_the_reservation_as_a_driver_entry(db_session: AsyncSession):
    w = await _world(db_session)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=BASE + 4 * HOUR)

    entries = await _busy(db_session, w, None, BASE + 5 * HOUR, BASE + 6 * HOUR, now=BASE + HOUR)

    drivers = {e.resource_id for e in entries if e.resource_type == CrewResourceType.DRIVER}
    assert drivers == {w.a, w.b}



async def _created_trip(db: AsyncSession, w: SubWorld, *, driver_id: uuid.UUID, horse_id: uuid.UUID) -> Trip:
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-2",
        operator_organization_id=w.org_id, client_organization_id=w.client_org_id,
        driver_id=driver_id, horse_id=horse_id, origin_precinct_id=w.origin_id,
        destination_precinct_id=w.dest_id, status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=w.user_id, planned_departure_at=BASE,
    )
    db.add(trip)
    await db.flush()
    return trip


async def _spare_horse(db: AsyncSession, w: SubWorld) -> uuid.UUID:
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=w.org_id, vehicle_type=VehicleType.HORSE,
        registration=f"S{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    db.add(horse)
    await db.flush()
    return horse.id


async def test_activation_is_blocked_by_a_live_trip_the_driver_took_over(db_session: AsyncSession):
    live = await _world(db_session)
    await complete_handover(db_session, live, outgoing=live.a, incoming=live.b)
    mine = await _created_trip(db_session, live, driver_id=live.b, horse_id=await _spare_horse(db_session, live))

    with pytest.raises(TripActivationBlockedError):
        await _claim_crew_for_activation(db_session, mine)


async def test_former_driver_can_activate_another_trip(db_session: AsyncSession):
    live = await _world(db_session)
    await complete_handover(db_session, live, outgoing=live.a, incoming=live.b)
    mine = await _created_trip(db_session, live, driver_id=live.a, horse_id=await _spare_horse(db_session, live))

    await _claim_crew_for_activation(db_session, mine)



@pytest_asyncio.fixture
async def wizard_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def test_wizard_greys_out_the_reserved_driver_and_frees_the_former_one(
    client: AsyncClient, db_session: AsyncSession, wizard_db,
):
    start = datetime.now(UTC) + timedelta(hours=1)
    w = await build_world(db_session, departure=start - HOUR, arrival=start + 8 * HOUR)
    await add_pending(db_session, w, outgoing=w.a, incoming=w.b, expected_at=start + 2 * HOUR)
    headers = auth_header(make_token(sub=str(w.user_id), role="dispatcher", org_id=str(w.org_id)))
    window = {"start": (start + 3 * HOUR).isoformat(), "end": (start + 4 * HOUR).isoformat()}

    reserved = (await client.get("/api/v1/trips/availability", params=window, headers=headers)).json()["busy"]
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    after = (await client.get("/api/v1/trips/availability", params=window, headers=headers)).json()["busy"]

    drivers = lambda busy: {b["resource_id"] for b in busy if b["resource_type"] == "driver"}  # noqa: E731
    assert drivers(reserved) == {str(w.a), str(w.b)}
    assert drivers(after) == {str(w.b)}
