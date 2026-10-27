"""A handshake at an outline precinct: the stored location assessment records the
outline it was judged against (policy 2026-10-14.1), not the radius.

FIXTURES: FP-143's corroborated-handshake trip and mocked Pulsit store, imported under
aliases for the same ruff F811 reason test_gps_mismatch.py documents.
"""

from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import ExceptionType, PhaseType
from app.db.models.organisations import Precinct
from app.db.models.transit import TripException
from app.schemas.action_location import ACTION_LOCATION_POLICY_VERSION

from tests.integration.test_phase_corroboration import (  # noqa: F401
    _HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG,
    _complete_activation, _load_event, _stage,
    override_get_db,
)
from tests.integration.test_phase_corroboration import (  # noqa: F401
    _corroboration_trip_fixture, _pulsit_store_fixture,
)

_LAT, _LNG = float(_ORIGIN_LAT), float(_ORIGIN_LNG)
_BOX = [[_LAT + 0.0005, _LNG - 0.0005], [_LAT + 0.0005, _LNG + 0.0005],
        [_LAT - 0.0005, _LNG + 0.0005], [_LAT - 0.0005, _LNG - 0.0005]]
_EAST_LNG = Decimal(str(round(_LNG + 0.00163, 7)))


async def _give_origin_an_outline(db_session, stop) -> None:
    precinct = await db_session.get(Precinct, stop.precinct_id)
    precinct.geofence_polygon = _BOX
    await db_session.flush()


async def test_assessment_records_the_outline_and_no_radius(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, _org, stop = corroboration_trip
    await _give_origin_an_outline(db_session, stop)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    response = await _complete_activation(
        client, trip, driver,
        driver_phone_lat=_LAT, driver_phone_lng=_LNG, driver_accuracy_metres=10.0,
    )

    assert response.status_code == 200
    assessment = (await _load_event(db_session, trip, PhaseType.ACTIVATION)).action_location_assessment
    assert assessment is not None
    assert assessment["policy_version"] == ACTION_LOCATION_POLICY_VERSION
    assert assessment["precinct_geofence_polygon"] == _BOX
    assert assessment["precinct_radius_metres"] is None
    assert assessment["driver_in_precinct"] is True
    assert assessment["truck_in_precinct"] is True


async def test_phone_outside_the_outline_but_inside_the_old_radius_is_outside(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, _org, stop = corroboration_trip
    await _give_origin_an_outline(db_session, stop)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    response = await _complete_activation(
        client, trip, driver,
        driver_phone_lat=_LAT, driver_phone_lng=float(_EAST_LNG), driver_accuracy_metres=10.0,
    )

    assert response.status_code == 200
    assessment = (await _load_event(db_session, trip, PhaseType.ACTIVATION)).action_location_assessment
    assert assessment is not None
    assert assessment["driver_in_precinct"] is False
    assert assessment["truck_in_precinct"] is True
    findings = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.DRIVER_LOCATION_MISMATCH,
        )
    )).scalars().all()
    assert len(findings) == 1
    assert "property outline of 4 corners" in findings[0].description
