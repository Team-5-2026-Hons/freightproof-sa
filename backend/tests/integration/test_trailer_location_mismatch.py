"""Integration tests for FP-146 — TRAILER_LOCATION_MISMATCH.

phases.findings._raise_trailer_decoupling_if_unrecorded raises one CRITICAL exception
per phase event when the horse's own verdict is TRUE (the precinct data and horse
tracker are sound), a trailer's snapshot is measured FALSE, and that trailer's fix is
further than settings.TRAILER_HORSE_MAX_SEPARATION_METRES from the horse's own fix —
a decoupled trailer, one of the strongest theft signals the system can see.

These assert the ACTUAL DATABASE STATE (the exception row, its severity/source/scope,
and the snapshot's own geofence_confirmed column) after a real phase completion over
HTTP, not a mock-call assertion — same contract as test_gps_mismatch.py, whose GPS_
MISMATCH story this one is the trailer-side sibling of.

FIXTURES: the trip, precincts, mocked Pulsit store and completion helpers are FP-143's
(tests/integration/test_phase_corroboration.py), imported rather than rebuilt, so this
story cannot drift from what a corroborated handshake looks like. Reuses the same
aliased-import pattern test_gps_mismatch.py already established, for the same ruff
F811 reason documented there.

Every scenario below completes the real ARRIVAL phase — the new destination-stop
phase — which is itself proof that arrival gets
trailer geofence verdicts exactly like every other stop phase.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.phases import TrailerGpsSnapshot
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.integrations.pulsit import MockPulsitClient

from tests.conftest import auth_header, make_token

# Imported for their fixture side effects and to keep this story's trip shape
# identical to FP-143/FP-145's — see this module's own docstring, and
# test_gps_mismatch.py's "FIXTURE ALIASING" note for why these are imported under
# different Python names than the parameters every test below still declares.
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _HORSE_DEVICE, _OPERATOR_ORG_ID, _ORIGIN_LAT, _ORIGIN_LNG,
    _FAR_AWAY_LAT, _FAR_AWAY_LNG, _TRAILER_A_DEVICE,
    _attach_trailer, _make_artifact, _phase_id, _stage,
    override_get_db,
)
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _corroboration_trip_fixture, _pulsit_store_fixture,
)

# ~356 m from the destination precinct centre: outside the default 200 m radius +
# 50 m tolerance geofence (so the trailer's OWN verdict is FALSE), but inside the
# 500 m TRAILER_HORSE_MAX_SEPARATION_METRES threshold when the horse itself sits at
# the precinct centre — the fence-edge case a coupled trailer produces on a real
# yard, which must NOT raise. Computed with core.geo.haversine_metres, not assumed.
_TRAILER_NEAR_FENCE_LAT = _FAR_AWAY_LAT + Decimal("0.0032")
_TRAILER_NEAR_FENCE_LNG = _FAR_AWAY_LNG


async def _mismatch_rows(db_session, trip: Trip) -> list[TripException]:
    result = await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.TRAILER_LOCATION_MISMATCH,
        )
    )
    return list(result.scalars().all())


async def _arrival_event_id(client: AsyncClient, trip_id: uuid.UUID, token: str) -> uuid.UUID:
    return uuid.UUID(await _phase_id(client, trip_id, token, "arrival"))


async def _arrival_snapshot(db_session, arrival_event_id: uuid.UUID) -> TrailerGpsSnapshot:
    result = await db_session.execute(
        select(TrailerGpsSnapshot).where(TrailerGpsSnapshot.phase_event_id == arrival_event_id)
    )
    return result.scalar_one()


async def _walk_to_arrival(
    client: AsyncClient, trip: Trip, token: str, *, seal_photo_id: str,
) -> None:
    """activation -> loading -> departure -> in_transit, staging the horse (and the
    trailer, when attached) at the ORIGIN precinct throughout, so none of these four
    earlier phases raises anything this story cares about. Mirrors the walk in
    test_phase_corroboration.test_corroboration_is_written_at_every_phase_not_only_
    the_first, trimmed to what reaching arrival needs.
    """
    bodies: list[dict[str, Any]] = [
        {"phase_type": "activation",
         "driver_phone_lat": float(_ORIGIN_LAT), "driver_phone_lng": float(_ORIGIN_LNG)},
        {"phase_type": "loading"},
        {"phase_type": "departure",
         "seal_number": "AB-1234", "seal_photo_artifact_id": seal_photo_id},
        {"phase_type": "in_transit"},
    ]
    for body in bodies:
        phase_event_id = await _phase_id(client, trip.id, token, body["phase_type"])
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
            headers=auth_header(token),
            json={
                **body, "idempotency_key": f"idem-{uuid.uuid4()}",
                "driver_captured_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 200, (body["phase_type"], resp.text)


async def _complete_arrival(
    client: AsyncClient, trip: Trip, token: str, *,
    seal_photo_id: str, idempotency_key: str | None = None,
) -> Any:
    arrival_id = await _phase_id(client, trip.id, token, "arrival")
    return await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        headers=auth_header(token),
        json={
            "phase_type": "arrival",
            "seal_condition": "intact",
            # Matches the seal staged at departure above, so the seal comparison
            # itself stays silent and only the trailer-location wiring is exercised.
            "seal_number_at_arrival": "AB-1234",
            "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": idempotency_key or f"idem-{uuid.uuid4()}",
            "driver_captured_at": datetime.now(UTC).isoformat(),
        },
    )


# ── the core positive case ──────────────────────────────────────────────────────


async def test_horse_inside_trailer_far_outside_raises_one_critical_exception(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, org, _stop0 = corroboration_trip
    trailer = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    # The horse reaches the destination precinct; the trailer does not — over a
    # thousand km away, unambiguously beyond TRAILER_HORSE_MAX_SEPARATION_METRES.
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    arrival_event_id = await _arrival_event_id(client, trip.id, token)
    mismatches = await _mismatch_rows(db_session, trip)
    assert len(mismatches) == 1

    exc = mismatches[0]
    assert exc.exception_type == ExceptionType.TRAILER_LOCATION_MISMATCH
    assert exc.source == ExceptionSource.SYSTEM
    assert exc.severity == ExceptionSeverity.CRITICAL
    assert exc.phase_event_id == arrival_event_id
    assert exc.trip_stop_id is not None
    assert trailer.registration in exc.description

    snapshot = await _arrival_snapshot(db_session, arrival_event_id)
    assert snapshot.geofence_confirmed is False


# ── the fence-edge case that must NOT raise ─────────────────────────────────────


async def test_horse_inside_trailer_just_outside_fence_but_within_horse_threshold_does_not_raise(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A trailer ~356 m from the horse's own fix — outside the geofence proper, but
    well within the horse's own separation threshold, the ordinary reading for a
    coupled trailer sitting a little further from the precinct's reference point."""
    trip, driver, org, _stop0 = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _stage(_TRAILER_A_DEVICE, _TRAILER_NEAR_FENCE_LAT, _TRAILER_NEAR_FENCE_LNG)

    resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    assert await _mismatch_rows(db_session, trip) == []

    arrival_event_id = await _arrival_event_id(client, trip.id, token)
    snapshot = await _arrival_snapshot(db_session, arrival_event_id)
    # The trailer's own verdict is still an honest FALSE — only the exception is
    # withheld, not the measurement.
    assert snapshot.geofence_confirmed is False


# ── horse itself is not confirmed: GPS_MISMATCH's territory, not this story's ──


async def test_horse_outside_precinct_raises_no_trailer_exception(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The horse's own verdict is FALSE (GPS_MISMATCH's finding), so nothing here
    vouches for the precinct data being sound enough to accuse a trailer over."""
    trip, driver, org, _stop0 = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    # Neither the horse nor the trailer ever reaches the destination.
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    arrival_event_id = await _arrival_event_id(client, trip.id, token)
    assert await _mismatch_rows(db_session, trip) == []
    snapshot = await _arrival_snapshot(db_session, arrival_event_id)
    assert snapshot.geofence_confirmed is False


async def test_horse_with_no_fix_raises_no_trailer_exception(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """No horse fix at all (dark tracker / untimely) means horse_gps_lat is NULL,
    which the raise guard checks explicitly, independent of the NULL/False verdict
    check above — a trailer cannot be judged "decoupled" from a horse whose own
    position at this handshake is unknown."""
    trip, driver, org, _stop0 = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    await MockPulsitClient(_OPERATOR_ORG_ID).stage_no_fix(_HORSE_DEVICE)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    assert await _mismatch_rows(db_session, trip) == []


# ── trailer genuinely coupled ────────────────────────────────────────────────────


async def test_trailer_inside_precinct_raises_nothing_and_snapshot_reads_true(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, org, _stop0 = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _stage(_TRAILER_A_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    assert await _mismatch_rows(db_session, trip) == []
    arrival_event_id = await _arrival_event_id(client, trip.id, token)
    snapshot = await _arrival_snapshot(db_session, arrival_event_id)
    assert snapshot.geofence_confirmed is True


# ── idempotency ──────────────────────────────────────────────────────────────────


async def test_replaying_the_same_completion_does_not_duplicate_the_exception(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, org, _stop0 = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)

    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    replayed_key = f"idem-{uuid.uuid4()}"

    first = await _complete_arrival(
        client, trip, token, seal_photo_id=arrival_seal_id, idempotency_key=replayed_key,
    )
    second = await _complete_arrival(
        client, trip, token, seal_photo_id=arrival_seal_id, idempotency_key=replayed_key,
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert len(await _mismatch_rows(db_session, trip)) == 1
