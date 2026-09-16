"""Integration contract for GET /api/v1/analytics/fleet/incidents (fleet analytics spec §5.6, 3.6).

A pin is where a named driver was, so the most important assertion here is what a pin does NOT
carry: its keys are exactly the spec's, with nothing about the person (spec D14, POPIA).
Over one seeded fortnight:
  panic (critical, located) on a closed trip           -> pin
  mechanical (warning, located) on an open trip        -> pin (any trip status)
  dispatcher note (located)                            -> never a pin (D10)
  seal mismatch with no location                       -> counted as unlocated
  a located report from before the period              -> not in the period
  another operator's located report                    -> never shown
"""

from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionSeverity, ExceptionType, TripStatus
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    Operator,
    add_exception,
    at_sast,
    headers,
    operator_from_seed,
    other_operator,
    seed_trip,
    today_sast,
)

_INCIDENTS = "/api/v1/analytics/fleet/incidents"
_WEEKS_BACK = 4
_PIN_KEYS = {"exception_id", "trip_id", "trip_reference", "exception_type", "severity", "created_at", "lat", "lng"}
_JOBURG = ("-26.2041000", "28.0473000")
_DURBAN = ("-29.8587000", "31.0218000")


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params() -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat()}


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def operator(seed: dict[str, Any]) -> Operator:
    return operator_from_seed(seed)


@pytest.fixture
def stops(seed: dict[str, Any]) -> list[Precinct]:
    return [seed["origin"], seed["dest"]]


async def _seed_reports(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> dict[str, Any]:
    closed = (await seed_trip(db, operator, stops=stops, start=at_sast(_day(1), 6))).trip
    open_trip = (await seed_trip(db, operator, stops=stops, start=at_sast(_day(8), 6), status=TripStatus.ACTIVE)).trip
    panic = await add_exception(
        db, closed, exception_type=ExceptionType.PANIC_BUTTON, severity=ExceptionSeverity.CRITICAL,
        created_at=at_sast(_day(1), 9), gps=_JOBURG,
    )
    breakdown = await add_exception(
        db, open_trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING,
        created_at=at_sast(_day(8), 10), gps=_DURBAN,
    )
    await add_exception(
        db, closed, exception_type=ExceptionType.DISPATCHER_NOTE, severity=ExceptionSeverity.INFO,
        created_at=at_sast(_day(2), 9), gps=_JOBURG,
    )
    await add_exception(
        db, closed, exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL,
        created_at=at_sast(_day(2), 10),
    )
    await add_exception(
        db, closed, exception_type=ExceptionType.PANIC_BUTTON, severity=ExceptionSeverity.CRITICAL,
        created_at=at_sast(_day(-2), 9), gps=_JOBURG,
    )
    other = await other_operator(db)
    stranger = (await seed_trip(db, other, stops=stops, start=at_sast(_day(3), 6))).trip
    await add_exception(
        db, stranger, exception_type=ExceptionType.PANIC_BUTTON, severity=ExceptionSeverity.CRITICAL,
        created_at=at_sast(_day(3), 9), gps=_DURBAN,
    )
    return {"panic": panic, "breakdown": breakdown, "closed": closed, "open": open_trip}


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_incidents_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_INCIDENTS, params=_params())

    assert response.status_code == 403


async def test_fleet_incidents_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_INCIDENTS, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_incidents_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_INCIDENTS, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_incidents_rejects_an_end_after_today(client: AsyncClient, operator: Operator) -> None:
    params = {"end": (today_sast() + timedelta(days=1)).isoformat()}

    response = await client.get(_INCIDENTS, params=params, headers=headers(operator))

    assert response.status_code == 422


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_incidents_for_an_org_without_reports_are_empty(client: AsyncClient, operator: Operator) -> None:
    response = await client.get(_INCIDENTS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    assert (response.json()["pins"], response.json()["unlocated_count"]) == ([], 0)


async def test_fleet_incident_pins_carry_nothing_about_the_driver(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_reports(db_session, operator, stops)

    response = await client.get(_INCIDENTS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    pins = response.json()["pins"]
    assert pins, "the seeded located reports should produce pins"
    for pin in pins:
        assert set(pin) == _PIN_KEYS
    assert operator.driver.full_name not in response.text
    assert operator.driver.phone_number not in response.text


async def test_fleet_incidents_pin_every_located_report_in_the_period_newest_first(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    seeded = await _seed_reports(db_session, operator, stops)

    response = await client.get(_INCIDENTS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    # The dispatcher note, the pre-period report and the other operator's never appear.
    assert [(pin["exception_id"], pin["trip_reference"], pin["severity"]) for pin in body["pins"]] == [
        (str(seeded["breakdown"].id), seeded["open"].trip_reference, "warning"),
        (str(seeded["panic"].id), seeded["closed"].trip_reference, "critical"),
    ]
    assert (body["pins"][1]["lat"], body["pins"][1]["lng"]) == pytest.approx((-26.2041, 28.0473))
    assert datetime.fromisoformat(body["pins"][1]["created_at"]) == at_sast(_day(1), 9)
    assert body["unlocated_count"] == 1
