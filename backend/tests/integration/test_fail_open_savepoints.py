"""WI-22: a fail-open write that hits a database error must not take the completion down.

Each fail-open finding is documented as "the handshake stands even if recording this fails".
That only holds if the write runs inside its own SAVEPOINT: a Postgres error aborts the whole
transaction, so catching the exception in Python leaves the request unable to run its next
statement (or its commit), and the driver's completion is lost with a 500.

How the failure is forced: not by pre-inserting the unique row (the helpers detect that and
return early, which never reaches the savepoint). Instead the value being written is made too
long for its column, so Postgres itself raises inside the write. That is a genuine aborted
transaction, the case the savepoint exists for, rather than a Python exception raised from a mock.

One test per wrapped site (the receiver-verification one lives in
test_receiver_verification_endpoints.py, beside its fixtures). Each asserts: HTTP 200, the phase
still COMPLETED with its own evidence hash and a pending anchor, the error logged, and no finding
row; the corroboration site also asserts the horse fix it returns is still recorded.
"""

import logging

from httpx import AsyncClient
from sqlalchemy import func, select

from app.db.models.enums import AnchorStatus, ExceptionType, PhaseStatus, PhaseType
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import TripException
from app.orchestration.evidence import corroboration
from app.orchestration.phases import findings as phase_findings

from tests.conftest import make_token

_TOO_LONG_FOR_REVIEW_STATUS = "x" * 40
_TOO_LONG_FOR_DEVICE_ID = "d" * 150

from tests.integration.test_phase_corroboration import (  # noqa: E402,F401
    _FAR_AWAY_LAT, _FAR_AWAY_LNG, _HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG, _TRAILER_A_DEVICE,
    _attach_trailer, _complete_activation, _load_event, _make_artifact,
    override_get_db,
)
from tests.integration.test_phase_corroboration import (  # noqa: E402,F401
    _corroboration_trip_fixture, _pulsit_store_fixture,
)
from tests.integration.test_phase_corroboration import _stage  # noqa: E402
from tests.integration.test_trailer_location_mismatch import (  # noqa: E402
    _complete_arrival, _walk_to_arrival,
)


async def _count(db_session, model, *where) -> int:
    return (await db_session.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


def _too_long_review_status(_severity: object) -> str:
    return _TOO_LONG_FOR_REVIEW_STATUS


async def _assert_phase_stands(db_session, trip, phase_type: PhaseType) -> PhaseEvent:
    event = await _load_event(db_session, trip, phase_type)
    await db_session.refresh(event)
    assert event.status == PhaseStatus.COMPLETED
    assert event.event_hash is not None
    assert event.anchor_status == AnchorStatus.PENDING
    return event


async def test_a_database_error_recording_the_position_finding_leaves_the_completion_standing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store, monkeypatch, caplog,
) -> None:
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    monkeypatch.setattr(phase_findings, "initial_review_status", _too_long_review_status)

    with caplog.at_level(logging.ERROR):
        resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200, resp.text
    event = await _assert_phase_stands(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is False
    assert await _count(
        db_session, TripException, TripException.trip_id == trip.id,
        TripException.exception_type == ExceptionType.GPS_MISMATCH,
    ) == 0
    assert "Could not record a position disagreement" in caplog.text


async def test_a_database_error_recording_the_trailer_finding_leaves_the_completion_standing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store, monkeypatch, caplog,
) -> None:
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    token = make_token(sub=str(driver.id), role="driver")
    departure_seal_id = await _make_artifact(db_session, trip.id)
    arrival_seal_id = await _make_artifact(db_session, trip.id)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _walk_to_arrival(client, trip, token, seal_photo_id=departure_seal_id)
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    monkeypatch.setattr(phase_findings, "initial_review_status", _too_long_review_status)

    with caplog.at_level(logging.ERROR):
        resp = await _complete_arrival(client, trip, token, seal_photo_id=arrival_seal_id)

    assert resp.status_code == 200, resp.text
    event = await _assert_phase_stands(db_session, trip, PhaseType.ARRIVAL)
    assert await _count(
        db_session, TripException, TripException.trip_id == trip.id,
        TripException.exception_type == ExceptionType.TRAILER_LOCATION_MISMATCH,
    ) == 0
    assert await _count(db_session, TrailerGpsSnapshot, TrailerGpsSnapshot.phase_event_id == event.id) == 1
    assert "Could not record a trailer decoupling" in caplog.text


async def test_a_database_error_saving_trailer_snapshots_leaves_the_completion_and_horse_fix_standing(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store, monkeypatch, caplog,
) -> None:
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    real_snapshot = corroboration._snapshot_for_trailer

    def overlong_snapshot(**kwargs):
        snapshot = real_snapshot(**kwargs)
        snapshot.pulsit_device_id = _TOO_LONG_FOR_DEVICE_ID
        return snapshot

    monkeypatch.setattr(corroboration, "_snapshot_for_trailer", overlong_snapshot)

    with caplog.at_level(logging.ERROR):
        resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200, resp.text
    event = await _assert_phase_stands(db_session, trip, PhaseType.ACTIVATION)
    assert await _count(db_session, TrailerGpsSnapshot, TrailerGpsSnapshot.phase_event_id == event.id) == 0
    assert event.horse_gps_lat is not None
    assert event.pulsit_geofence_confirmed is True
    assert "Could not record trailer position snapshots" in caplog.text
