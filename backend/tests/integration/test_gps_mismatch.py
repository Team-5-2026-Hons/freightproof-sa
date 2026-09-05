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
"""

import uuid
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from unittest.mock import patch

from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, PhaseType,
)
from app.db.models.transit import TripException
from app.orchestration import phase_service

# Imported for their fixture side effects as much as their bodies — `override_get_db`
# is autouse in its defining module and stays autouse here, which is what points the
# app's get_db dependency at the test session.
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG, _FAR_AWAY_LAT, _FAR_AWAY_LNG,
    _complete_activation, _fake_hedera_receipt, _load_event, _make_artifact,
    _phase_id, _stage,
    corroboration_trip, override_get_db, pulsit_store,
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
    assert exc.resolved is False


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
        json={"phase_type": "loading", "idempotency_key": f"idem-{uuid.uuid4()}"},
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
    await MockPulsitClient().stage_no_fix(_HORSE_DEVICE)

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
        db_session, trip_id=trip.id, event=event,
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
    exc.resolved = True
    await db_session.flush()

    await phase_service._raise_position_disagreement_if_unrecorded(
        db_session, trip_id=trip.id, event=event,
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
