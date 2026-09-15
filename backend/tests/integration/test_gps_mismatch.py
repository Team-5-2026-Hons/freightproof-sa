"""Integration tests for FP-145 — a position disagreement raises GPS_MISMATCH.

`ExceptionType.GPS_MISMATCH` has existed in the enum since the initial schema and has
never once been written. These tests are the first thing that makes it fire, so they
assert the ACTUAL EXCEPTION ROW in the database — its type, source, severity, the
phase event it hangs off and the positions reachable from it. A mock-call assertion
would pass just as happily against a system that still writes nothing.

What each block proves:

  * a FALSE verdict writes exactly one exception, scoped to the right phase and stop,
    with both position sources reachable from the row
  * a TRUE verdict writes nothing
  * a NULL verdict writes nothing — the single most important rule in the story: a
    driver in a coverage dead zone on the N3 must never have a position disagreement
    recorded against their name because a tracker could not be reached
  * a re-synced handshake from the driver app's offline queue adds no second row
  * a failure while recording the finding still leaves the handshake successful

FIXTURES: the trip, the precincts, the mocked Pulsit store and the completion helpers
are FP-143's, imported rather than rebuilt, so the two stories cannot drift apart on
what a corroborated handshake looks like. Their provenance note applies here too — no
position in this module was recorded from real Pulsit hardware.

FIXTURE ALIASING (ruff F811): `corroboration_trip` and `pulsit_store` are imported
under different Python names below (`_corroboration_trip_fixture`, `_pulsit_store_
fixture`) even though every test in this file still declares plain `corroboration_trip`
/`pulsit_store` parameters. Importing them under their OWN names would bind those exact
identifiers at module scope, and ruff reads every later test parameter of the same name
as "redefining" that unused import (F811) — this file used to do exactly that and carry
30 such findings. The two fixtures are registered in test_phase_corroboration.py with an
explicit `name=` on their decorator (`@pytest.fixture(name="pulsit_store")` etc.), so
pytest resolves them by that name regardless of which Python identifier they are
imported as here — aliasing the import is enough to remove the collision without
changing a single test signature. `override_get_db` needs no alias: it is autouse and
never appears as a parameter anywhere in this file, so nothing here ever rebinds its
name.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import patch

from app.db.models.enums import (
    ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType,
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration import action_location_service
from app.schemas.action_location import ActionLocationAssessment
from app.orchestration import phase_service

# Imported for their fixture side effects as much as their bodies — `override_get_db`
# is autouse in its defining module and stays autouse here, which is what points the
# app's get_db dependency at the test session. See the module docstring's "FIXTURE
# ALIASING" note for why corroboration_trip/pulsit_store are imported under different
# names.
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _HORSE_DEVICE, _OPERATOR_ORG_ID, _ORIGIN_LAT, _ORIGIN_LNG,
    _FAR_AWAY_LAT, _FAR_AWAY_LNG,
    _complete_activation, _fake_hedera_receipt, _load_event, _make_artifact,
    _phase_id, _stage,
    override_get_db,
)
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _corroboration_trip_fixture, _pulsit_store_fixture,
)
from tests.conftest import auth_header, make_token
from app.integrations.pulsit import MockPulsitClient

# 0.0075 degrees of latitude north of the origin precinct — 834 m away. Comfortably
# outside the 200 m default radius widened by the 50 m operational tolerance, so the
# verdict is unambiguously FALSE, while still being close enough that the separation
# renders in metres. That combination is what makes this the fixture for the
# sub-kilometre wording; _FAR_AWAY_* covers the kilometre-scale case.
_NEARBY_OUTSIDE_LAT = Decimal("-33.9174")
_NEARBY_OUTSIDE_LNG = _ORIGIN_LNG
_NEARBY_OUTSIDE_SEPARATION = "834 m"


async def _load_mismatches(db_session, trip) -> list[TripException]:
    result = await db_session.execute(
        select(TripException)
        .where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.GPS_MISMATCH,
        )
        .order_by(TripException.created_at)
    )
    return list(result.scalars().all())


async def _load_separations(db_session, trip) -> list[TripException]:
    result = await db_session.execute(
        select(TripException)
        .where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION,
        )
        .order_by(TripException.created_at)
    )
    return list(result.scalars().all())


async def test_reliable_far_phone_raises_separation_when_truck_is_inside_precinct(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Phone/truck disagreement is evidence even when the truck passes its geofence."""
    trip, driver, _org, stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    response = await _complete_activation(
        client,
        trip,
        driver,
        driver_phone_lat=float(_FAR_AWAY_LAT),
        driver_phone_lng=float(_FAR_AWAY_LNG),
        driver_accuracy_metres=10.0,
    )

    assert response.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is True
    assert event.action_location_assessment["proximity"] == "separated"
    assert event.action_location_assessment["truck_in_precinct"] is True
    assert event.action_location_assessment["driver_in_precinct"] is False
    assert event.action_location_assessment["expected_trip_stop_id"] == str(stop.id)
    assert len(await _load_separations(db_session, trip)) == 1
    assert await _load_mismatches(db_session, trip) == []


async def test_colocated_sources_outside_precinct_raise_only_existing_geofence_finding(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A precinct miss must not be relabelled as driver/vehicle disagreement."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    response = await _complete_activation(
        client,
        trip,
        driver,
        driver_phone_lat=float(_FAR_AWAY_LAT),
        driver_phone_lng=float(_FAR_AWAY_LNG),
        driver_accuracy_metres=10.0,
    )

    assert response.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is False
    assert event.action_location_assessment["proximity"] == "within_limit"
    assert len(await _load_mismatches(db_session, trip)) == 1
    assert await _load_separations(db_session, trip) == []


async def test_geofence_and_reliable_separation_findings_can_coexist(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The two independent facts retain their distinct exception types on one event."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    response = await _complete_activation(
        client,
        trip,
        driver,
        driver_accuracy_metres=10.0,
    )

    assert response.status_code == 200
    assert len(await _load_mismatches(db_session, trip)) == 1
    assert len(await _load_separations(db_session, trip)) == 1


async def test_legacy_missing_timing_and_accuracy_persists_unverified_assessment(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Pre-assessment clients remain accepted, but no positive proximity claim is made."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    response = await _complete_activation(
        client,
        trip,
        driver,
        omit_driver_captured_at=True,
    )

    assert response.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.action_location_assessment["proximity"] == "unverified"
    assert "missing_time" in event.action_location_assessment["reasons"]
    assert "missing_accuracy" in event.action_location_assessment["reasons"]
    assert await _load_mismatches(db_session, trip) == []
    assert await _load_separations(db_session, trip) == []


async def test_replayed_completion_keeps_one_separation_finding(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The source-event partial uniqueness preserves one finding across an offline replay."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    token = make_token(sub=str(driver.id), role="driver")
    idempotency_key = f"idem-{uuid.uuid4()}"
    request = {
        "idempotency_key": idempotency_key,
        "token": token,
        "driver_phone_lat": float(_FAR_AWAY_LAT),
        "driver_phone_lng": float(_FAR_AWAY_LNG),
        "driver_accuracy_metres": 10.0,
    }

    first = await _complete_activation(client, trip, driver, **request)
    replay = await _complete_activation(client, trip, driver, **request)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert len(await _load_separations(db_session, trip)) == 1


async def _seed_committed_separation_race_world(session: AsyncSession) -> dict[str, uuid.UUID]:
    """Create the committed parent rows visible to the two independent racers."""
    suffix = uuid.uuid4().hex[:8]
    operator = Organization(
        id=uuid.uuid4(), name=f"Race operator {suffix}", org_type=OrganizationType.OPERATOR,
    )
    principal = Organization(
        id=uuid.uuid4(), name=f"Race principal {suffix}", org_type=OrganizationType.PRINCIPAL,
    )
    session.add_all([operator, principal])
    await session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=operator.id,
        email=f"race-{suffix}@test.co.za", full_name="Race dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=operator.id, full_name="Race driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"R-{suffix}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE,
        registration=f"R{suffix[:6].upper()}", pulsit_device_id=f"RACE-{suffix}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Race origin", principal_organization_id=principal.id,
        latitude=_ORIGIN_LAT, longitude=_ORIGIN_LNG,
    )
    destination = Precinct(
        id=uuid.uuid4(), name="Race destination", principal_organization_id=principal.id,
        latitude=_FAR_AWAY_LAT, longitude=_FAR_AWAY_LNG,
    )
    session.add_all([user, driver, horse, origin, destination])
    await session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-RACE-{suffix}", order_number=f"ORD-RACE-{suffix}",
        operator_organization_id=operator.id, client_organization_id=principal.id,
        driver_id=driver.id, horse_id=horse.id, origin_precinct_id=origin.id,
        destination_precinct_id=destination.id, status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    session.add(trip)
    await session.flush()
    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0)
    session.add(stop)
    await session.flush()
    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.ACTIVATION, sequence_number=1, status=PhaseStatus.COMPLETED,
    )
    session.add(event)
    await session.commit()
    return {
        "operator_id": operator.id,
        "principal_id": principal.id,
        "user_id": user.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "origin_id": origin.id,
        "destination_id": destination.id,
        "trip_id": trip.id,
        "stop_id": stop.id,
        "event_id": event.id,
    }


async def _delete_committed_separation_race_world(session: AsyncSession, ids: dict[str, uuid.UUID]) -> None:
    await session.execute(delete(TripException).where(TripException.phase_event_id == ids["event_id"]))
    await session.execute(delete(PhaseEvent).where(PhaseEvent.id == ids["event_id"]))
    await session.execute(delete(TripStop).where(TripStop.id == ids["stop_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["destination_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id == ids["user_id"]))
    await session.execute(delete(Organization).where(Organization.id.in_([ids["operator_id"], ids["principal_id"]])))
    await session.commit()


async def test_concurrent_separation_finding_attempts_recover_the_partial_unique_race(
    test_engine, monkeypatch,
):
    """Two independent transactions both miss the lookup; the DB index admits one row.

    The shared `db_session` fixture cannot prove this: its sessions share an outer
    transaction. The barrier is deliberately after the real SELECT and before the real
    SAVEPOINT insert, so both requests enter the exact select-then-insert race window
    and the losing transaction must exercise the named-index IntegrityError recovery.
    """
    async with AsyncSession(test_engine, expire_on_commit=False) as seed_session:
        ids = await _seed_committed_separation_race_world(seed_session)

    barrier = asyncio.Barrier(2)
    original_find = action_location_service._find_existing_separation

    async def synchronized_find(*args, **kwargs):
        existing = await original_find(*args, **kwargs)
        await barrier.wait()
        return existing

    monkeypatch.setattr(action_location_service, "_find_existing_separation", synchronized_find)
    assessment = ActionLocationAssessment(
        policy_version="test-policy", evaluated_at=datetime.now(UTC),
        driver_lat=float(_ORIGIN_LAT), driver_lng=float(_ORIGIN_LNG),
        driver_captured_at=datetime.now(UTC), driver_accuracy_metres=10.0,
        tracker_lat=float(_FAR_AWAY_LAT), tracker_lng=float(_FAR_AWAY_LNG),
        tracker_captured_at=datetime.now(UTC), separation_metres=1_000.0,
        proximity="separated", reasons=[], max_separation_metres=100.0,
        max_age_seconds=60, max_skew_seconds=30, max_phone_accuracy_metres=50.0,
        expected_trip_stop_id=ids["stop_id"], precinct_id=None, precinct_lat=None,
        precinct_lng=None, precinct_radius_metres=None, precinct_tolerance_metres=None,
        driver_in_precinct=None, truck_in_precinct=None,
    )

    async def attempt() -> None:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            trip = await session.get(Trip, ids["trip_id"])
            assert trip is not None
            await action_location_service.record_separation_finding(
                session, trip=trip, phase_event_id=ids["event_id"], checkpoint_id=None,
                assessment=assessment,
            )
            await session.commit()

    try:
        outcomes = await asyncio.gather(attempt(), attempt(), return_exceptions=True)
        failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
        assert failures == [], f"parallel finding attempts failed: {failures!r}"

        async with AsyncSession(test_engine, expire_on_commit=False) as verify_session:
            findings = (await verify_session.execute(
                select(TripException).where(
                    TripException.phase_event_id == ids["event_id"],
                    TripException.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION,
                )
            )).scalars().all()
        assert len(findings) == 1
    finally:
        async with AsyncSession(test_engine, expire_on_commit=False) as cleanup_session:
            await _delete_committed_separation_race_world(cleanup_session, ids)


# ── A false verdict raises, and carries what the timeline needs ────────────────


async def test_a_false_verdict_raises_exactly_one_gps_mismatch(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The demo, in one test: the tracker says one place, the phone says another."""
    trip, driver, _org, stop0 = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    mismatches = await _load_mismatches(db_session, trip)
    assert len(mismatches) == 1

    exc = mismatches[0]
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert exc.exception_type == ExceptionType.GPS_MISMATCH
    # SYSTEM, never DRIVER. The entire evidential weight of this finding is that a
    # source the driver cannot influence produced it.
    assert exc.source == ExceptionSource.SYSTEM
    assert exc.severity == ExceptionSeverity.WARNING
    assert exc.phase_event_id == event.id
    assert exc.trip_stop_id == stop0.id
    assert exc.review_status == ExceptionReviewStatus.RECORDED


async def test_the_exception_carries_both_positions_and_the_separation(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Both sources must be reachable from the row, or the timeline cannot show them.

    The tracker's position is deliberately NOT copied onto the exception: it lives on
    the phase_events row this exception points at, alongside the driver's, and a
    second copy could drift out of step with the first. This asserts the join is
    intact — the exception names a phase event that carries both fixes.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _NEARBY_OUTSIDE_LAT, _NEARBY_OUTSIDE_LNG)

    await _complete_activation(client, trip, driver)

    exc = (await _load_mismatches(db_session, trip))[0]
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)

    # The driver's phone fix, on the exception's own columns.
    assert exc.gps_lat == _ORIGIN_LAT
    assert exc.gps_lng == _ORIGIN_LNG
    # The tracker's fix, on the phase event the exception hangs off.
    assert event.horse_gps_lat == _NEARBY_OUTSIDE_LAT
    assert event.horse_gps_lng == _NEARBY_OUTSIDE_LNG
    assert event.driver_phone_lat == _ORIGIN_LAT

    # Under a kilometre reads in metres, never "0.8 km".
    assert _NEARBY_OUTSIDE_SEPARATION in exc.description
    assert "km" not in exc.description


async def test_a_kilometre_scale_separation_reads_in_kilometres(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """"Driver and truck 1261.6 km apart" — the fact, with no verdict attached."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    await _complete_activation(client, trip, driver)

    exc = (await _load_mismatches(db_session, trip))[0]
    assert "1261.6 km apart" in exc.description


async def test_the_description_states_a_measurement_and_never_a_verdict(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A dispatcher decides what the separation means; this row must not decide for them.

    Guarding the copy in a test rather than in review only, because the wording is the
    part of this story most likely to be "improved" later by someone who has not read
    the reasoning. The platform reports a measured distance between two independent
    sources. It does not accuse anyone.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    await _complete_activation(client, trip, driver)

    description = (await _load_mismatches(db_session, trip))[0].description.lower()
    for accusation in (
        "fraud", "fraudulent", "lying", "lied", "false claim", "falsified", "faked",
        "fake", "spoof", "theft", "stolen", "suspicious", "suspected", "dishonest",
    ):
        assert accusation not in description, accusation


async def test_a_handshake_with_no_driver_phone_fix_says_so_rather_than_inventing_zero(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """One source is still a finding; a separation of zero would be a fabrication.

    driver_phone_lat/lng are optional on the wire for every phase except activation
    (a fix can time out under a loading-bay roof), so a loading can complete carrying
    only the tracker's position. The geofence verdict is unaffected — it never
    involved the phone — but the separation is not measurable, and the row must say
    so rather than report a distance it did not measure.
    """
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")

    # Activation happens legitimately at the origin, so it raises nothing and the
    # loading below is the only finding on the trip.
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _complete_activation(client, trip, driver, token=token)

    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    phase_event_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        headers=auth_header(token),
        # Task 0A: within skew of the staged fix's default "now" — this test is about
        # the missing PHONE fix, not about the corroboration timing gate.
        json={
            "phase_type": "loading", "idempotency_key": f"idem-{uuid.uuid4()}",
            "driver_captured_at": datetime.now(UTC).isoformat(),
        },
    )

    assert resp.status_code == 200
    mismatches = await _load_mismatches(db_session, trip)
    assert len(mismatches) == 1

    exc = mismatches[0]
    assert "could not be measured" in exc.description
    # No phone fix to attach, and none invented.
    assert exc.gps_lat is None
    assert exc.gps_lng is None


# ── NULL never raises. The rule the whole story turns on. ──────────────────────


async def test_a_true_verdict_raises_nothing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is True
    assert await _load_mismatches(db_session, trip) == []


async def test_a_dark_tracker_raises_nothing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """THE most important test in this story.

    A driver in a coverage dead zone on the N3 must never generate a position
    disagreement against their name because a tracker was unreachable. FP-143 records
    that as NULL — "we could not check" — and this asserts NULL is silent. If the
    raise guard is ever loosened from `is False` to a falsiness test, `not None` is
    True and this is the test that fails.
    """
    trip, driver, _org, _stop = corroboration_trip
    await MockPulsitClient(_OPERATOR_ORG_ID).stage_no_fix(_HORSE_DEVICE)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert await _load_mismatches(db_session, trip) == []


async def test_an_unknown_device_raises_nothing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Nothing staged and not in the demo fixture library — a fleet-record fault.

    The second route to NULL, and it must be as silent as the first.
    """
    trip, driver, _org, _stop = corroboration_trip

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    assert await _load_mismatches(db_session, trip) == []


async def test_a_pulsit_outage_raises_nothing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Pulsit unreachable is an admission, not a measurement."""
    trip, driver, _org, _stop = corroboration_trip

    with patch(
        "app.orchestration.corroboration_service.get_pulsit_client",
        side_effect=RuntimeError("Pulsit unreachable"),
    ):
        resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert await _load_mismatches(db_session, trip) == []


async def test_a_stale_capture_time_raises_no_gps_mismatch_even_though_the_fix_is_far_away(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Task 0A: an untimely fix is 'could not compare', never a manufactured mismatch.

    The tracker really is far away RIGHT NOW, which — if trusted — would read as a
    clean FALSE verdict and raise (see test_a_false_verdict_raises_exactly_one_gps_
    mismatch, same coordinates). But the driver's own capture instant is hours old, so
    the timing cannot be verified, and the honest outcome is silence, not an
    accusation — this is the offline-replay scenario task 0A exists to close.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    stale_capture = (datetime.now(UTC) - timedelta(hours=3)).isoformat()

    resp = await _complete_activation(client, trip, driver, driver_captured_at=stale_capture)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert await _load_mismatches(db_session, trip) == []


async def test_a_missing_driver_captured_at_raises_no_gps_mismatch(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The second route to the same NULL — an older client that never sends
    driver_captured_at at all gets the identical honest silence as one whose capture
    time is stale. Never treated as "assume it's live" just because the field is absent.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _complete_activation(client, trip, driver, omit_driver_captured_at=True)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert await _load_mismatches(db_session, trip) == []


async def test_in_transit_never_raises_even_from_far_away(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """in_transit is anchored to the stop it DEPARTED FROM, so it carries no verdict.

    FP-143 excludes it deliberately: judging an arrival attestation against the origin
    would stamp a mismatch on every healthy trip in the fleet. This is the seam test —
    if that exclusion is ever removed, this story starts fabricating accusations at
    scale, and this fails first.
    """
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    seal_photo_id = await _make_artifact(db_session, trip.id)
    bodies: list[dict] = [
        {"phase_type": "activation",
         "driver_phone_lat": float(_ORIGIN_LAT), "driver_phone_lng": float(_ORIGIN_LNG)},
        {"phase_type": "loading"},
        {"phase_type": "departure",
         "seal_number": "AB-1234", "seal_photo_artifact_id": seal_photo_id},
    ]
    # departure anchors to Hedera; patched so this walk exercises the raise wiring
    # rather than the network.
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        for body in bodies:
            phase_event_id = await _phase_id(client, trip.id, token, body["phase_type"])
            resp = await client.post(
                f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
                headers=auth_header(token),
                json={**body, "idempotency_key": f"idem-{uuid.uuid4()}"},
            )
            assert resp.status_code == 200, (body["phase_type"], resp.text)

    # The horse is still at the origin, which for in_transit's own stop is "inside" —
    # but no verdict is recorded either way, so nothing can be raised from it.
    phase_event_id = await _phase_id(client, trip.id, token, "in_transit")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        headers=auth_header(token),
        json={"phase_type": "in_transit", "idempotency_key": f"idem-{uuid.uuid4()}"},
    )

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.IN_TRANSIT)
    assert event.pulsit_geofence_confirmed is None
    assert [e for e in await _load_mismatches(db_session, trip)
            if e.phase_event_id == event.id] == []


# ── The offline queue re-syncs. One exception per event, always. ───────────────


async def test_a_resynced_handshake_raises_no_second_exception(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The driver app flushes its queue more than once; the ledger must not double up."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    token = make_token(sub=str(driver.id), role="driver")
    key = f"idem-{uuid.uuid4()}"

    first = await _complete_activation(client, trip, driver, idempotency_key=key, token=token)
    second = await _complete_activation(client, trip, driver, idempotency_key=key, token=token)

    assert first.status_code == 200
    assert second.status_code == 200
    assert len(await _load_mismatches(db_session, trip)) == 1


async def test_the_raise_is_idempotent_against_the_phase_event_itself(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Idempotency that does not depend on the completion gate upstream holding.

    _gate_and_load already short-circuits a replayed completion, which is what the
    test above exercises end to end. This one calls the raise directly, twice, so the
    guarantee is proven where it is written rather than inferred from a caller.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _complete_activation(client, trip, driver)
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)

    await phase_service._raise_position_disagreement_if_unrecorded(
        db_session, trip=trip, event=event,
    )
    await db_session.flush()

    assert len(await _load_mismatches(db_session, trip)) == 1


async def test_a_resolved_finding_does_not_reappear_on_the_next_resync(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A dispatcher who has actioned this must not be handed it again.

    The existence check is deliberately NOT filtered on `resolved`, unlike the scan
    shortfall's, which asks a different question ("is this still on the list?"). Here
    the question is "has this event already been reported?", and the answer does not
    change because someone dealt with it.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _complete_activation(client, trip, driver)
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)

    exc = (await _load_mismatches(db_session, trip))[0]
    exc.review_status = ExceptionReviewStatus.REVIEWED
    await db_session.flush()

    await phase_service._raise_position_disagreement_if_unrecorded(
        db_session, trip=trip, event=event,
    )
    await db_session.flush()

    assert len(await _load_mismatches(db_session, trip)) == 1


# ── A failed raise never fails a handshake ─────────────────────────────────────


async def test_a_failure_recording_the_finding_leaves_the_handshake_successful(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The driver is standing at a gate and has already done the thing being recorded.

    Same fail-open stance as the Hedera anchor and the Pulsit corroboration itself: an
    annotation failing must never undo evidence of something that physically happened.
    The corroboration columns still carry the finding, so it is not lost — only the
    exception row is missing, and the phase row still reads a false verdict.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    with patch.object(
        phase_service, "_phone_tracker_separation_metres",
        side_effect=RuntimeError("separation maths blew up"),
    ):
        resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is False
    assert await _load_mismatches(db_session, trip) == []
