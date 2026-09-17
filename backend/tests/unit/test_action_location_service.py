"""Focused behaviour tests for separation-finding and driver-location-mismatch
persistence (action_location_service.record_separation_finding /
record_driver_location_finding)."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.db.models.enums import (
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.action_location_service import (
    record_driver_location_finding, record_separation_finding,
)
from app.schemas.action_location import ActionLocationAssessment, ProximityVerdict


def _assessment(
    *,
    proximity: ProximityVerdict = "unverified",
    separation_metres: float | None = None,
    driver_in_precinct: bool | None = None,
    precinct_radius_metres: float | None = 200.0,
    precinct_tolerance_metres: float | None = 50.0,
    expected_trip_stop_id: uuid.UUID | None = None,
) -> ActionLocationAssessment:
    evaluated_at = datetime.now(UTC)
    return ActionLocationAssessment(
        policy_version="test-policy",
        evaluated_at=evaluated_at,
        driver_lat=-33.9249,
        driver_lng=18.4241,
        driver_captured_at=evaluated_at,
        driver_accuracy_metres=10.0,
        tracker_lat=-26.2041,
        tracker_lng=28.0473,
        tracker_captured_at=evaluated_at,
        separation_metres=separation_metres,
        proximity=proximity,
        reasons=[],
        max_separation_metres=100.0,
        max_age_seconds=60,
        max_skew_seconds=30,
        max_phone_accuracy_metres=50.0,
        expected_trip_stop_id=expected_trip_stop_id,
        precinct_id=uuid.uuid4() if driver_in_precinct is not None else None,
        precinct_lat=-33.9 if driver_in_precinct is not None else None,
        precinct_lng=18.4 if driver_in_precinct is not None else None,
        precinct_radius_metres=precinct_radius_metres,
        precinct_tolerance_metres=precinct_tolerance_metres,
        driver_in_precinct=driver_in_precinct,
        truck_in_precinct=None,
    )


def _separated_assessment() -> ActionLocationAssessment:
    return _assessment(proximity="separated", separation_metres=1_000.0)


async def test_unexpected_database_failure_propagates_from_separation_persistence() -> None:
    """Only the named partial-index race is recoverable; an outage must stay visible."""
    db = SimpleNamespace(execute=AsyncMock(side_effect=OperationalError("SELECT", {}, RuntimeError("down"))))
    trip = SimpleNamespace(id=uuid.uuid4(), operator_organization_id=uuid.uuid4())

    with pytest.raises(OperationalError, match="down"):
        await record_separation_finding(
            db,
            trip=trip,
            phase_event_id=uuid.uuid4(),
            checkpoint_id=None,
            assessment=_separated_assessment(),
        )


# ── record_driver_location_finding: driver's phone vs the stop's precinct ───────


@pytest_asyncio.fixture(name="located_trip")
async def _located_trip_fixture(db_session):
    """One operator org with a trip and one stop-anchored, PENDING activation phase
    — the minimal shape record_driver_location_finding is scoped against."""
    org = Organization(id=uuid.uuid4(), name="Op-loc", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Cl-loc", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="loc@test.co.za", full_name="U")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-LOC",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="LOCHRS1", pulsit_device_id="PUL-LOC",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="O", principal_organization_id=client_org.id,
        latitude="-33.9249", longitude="18.4241",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="D", principal_organization_id=client_org.id,
        latitude="-26.2041", longitude="28.0473",
    )
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-LOC", order_number="ORD-LOC",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0)
    db_session.add(stop)
    await db_session.flush()

    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.ACTIVATION, sequence_number=1, status=PhaseStatus.PENDING,
    )
    db_session.add(event)
    await db_session.flush()

    return trip, event, stop


async def _mismatch_rows(db_session, phase_event_id) -> list[TripException]:
    result = await db_session.execute(
        select(TripException).where(
            TripException.phase_event_id == phase_event_id,
            TripException.exception_type == "driver_location_mismatch",
        )
    )
    return list(result.scalars().all())


async def test_driver_outside_precinct_raises_exactly_one_finding(db_session, located_trip):
    trip, event, stop = located_trip
    assessment = _assessment(driver_in_precinct=False, expected_trip_stop_id=stop.id)

    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
    )

    rows = await _mismatch_rows(db_session, event.id)
    assert len(rows) == 1
    assert rows[0].source == "system"
    assert rows[0].severity == "warning"
    assert rows[0].review_status == "needs_review"
    assert rows[0].trip_stop_id == stop.id


@pytest.mark.parametrize("driver_in_precinct", [None, True])
async def test_not_measurably_outside_raises_nothing(db_session, located_trip, driver_in_precinct):
    """None (not assessable) and True (a clean pass) must never raise a finding."""
    trip, event, stop = located_trip
    assessment = _assessment(driver_in_precinct=driver_in_precinct, expected_trip_stop_id=stop.id)

    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
    )

    assert await _mismatch_rows(db_session, event.id) == []


async def test_driver_reason_is_attributed_in_the_description(db_session, located_trip):
    trip, event, stop = located_trip
    assessment = _assessment(driver_in_precinct=False, expected_trip_stop_id=stop.id)

    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
        driver_reason="Gate guard sent me to the overflow yard across the road.",
    )

    rows = await _mismatch_rows(db_session, event.id)
    assert "Driver's reason:" in rows[0].description
    assert "overflow yard" in rows[0].description


async def test_an_overlong_driver_reason_is_truncated_not_rejected(db_session, located_trip):
    trip, event, stop = located_trip
    assessment = _assessment(driver_in_precinct=False, expected_trip_stop_id=stop.id)
    long_reason = "x" * 1_000

    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
        driver_reason=long_reason,
    )

    rows = await _mismatch_rows(db_session, event.id)
    assert len(rows[0].description) < len(long_reason)
    assert "…" in rows[0].description


async def test_replaying_the_same_handshake_does_not_duplicate_the_finding(db_session, located_trip):
    trip, event, stop = located_trip
    assessment = _assessment(driver_in_precinct=False, expected_trip_stop_id=stop.id)

    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
    )
    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
    )

    assert len(await _mismatch_rows(db_session, event.id)) == 1


async def test_separation_and_location_mismatch_on_one_handshake_are_two_distinct_rows(
    db_session, located_trip,
):
    """The two findings are independent questions — both can fire on the same
    handshake, and each must land its own row rather than colliding or suppressing
    the other."""
    trip, event, stop = located_trip
    assessment = _assessment(
        proximity="separated", separation_metres=1_000.0,
        driver_in_precinct=False, expected_trip_stop_id=stop.id,
    )

    await record_separation_finding(
        db_session, trip=trip, phase_event_id=event.id, checkpoint_id=None,
        assessment=assessment,
    )
    await record_driver_location_finding(
        db_session, trip=trip, phase_event_id=event.id, assessment=assessment,
    )

    result = await db_session.execute(
        select(TripException).where(TripException.phase_event_id == event.id)
    )
    rows = list(result.scalars().all())
    assert len(rows) == 2
    assert {row.exception_type for row in rows} == {"driver_vehicle_separation", "driver_location_mismatch"}
