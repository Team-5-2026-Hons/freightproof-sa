"""Integration contract for GET /api/v1/analytics/fleet/tiles (fleet analytics spec §5.0).

Each expected number is hand-computed from the rows the test seeds. Timestamps are derived
from "now" in SAST, so tests say "5 days ago" rather than name a calendar date. The endpoint
reads base tables only, so no `views` fixture is needed.
"""

from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.constants import TILE_WINDOW_DAYS
from app.db.models.enums import (
    AnchorStatus,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionType,
    PhaseStatus,
    PhaseType,
    TripStatus,
    TripType,
    VehicleType,
)
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    SINGLE_LEG,
    Operator,
    add_exception,
    at_sast,
    days_ago,
    headers,
    new_driver,
    new_vehicle,
    not_started,
    operator_from_seed,
    other_operator,
    replace_step,
    seed_trip,
    start_for_departure,
    today_sast,
)

_TILES = "/api/v1/analytics/fleet/tiles"


def _bands(**counts: int) -> dict[str, int]:
    return {
        "expired": 0, "within_30_days": 0, "within_90_days": 0, "within_180_days": 0,
        "no_date": 0, **counts,
    }


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


# ── Auth ─────────────────────────────────────────────────────────────────────


async def test_fleet_tiles_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_TILES)

    assert response.status_code == 403


async def test_fleet_tiles_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_TILES, headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_tiles_with_expired_token_returns_401(
    client: AsyncClient, operator: Operator,
) -> None:
    token = make_token(
        sub=str(operator.dispatcher.id), role="dispatcher", org_id=str(operator.org.id),
        expires_in=-1,
    )

    response = await client.get(_TILES, headers=auth_header(token))

    assert response.status_code == 401


async def test_fleet_tiles_with_driver_token_returns_403(
    client: AsyncClient, operator: Operator,
) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_TILES, headers=auth_header(token))

    assert response.status_code == 403


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_tiles_for_an_org_without_trips_returns_zeros(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert body["live_trips"] == 0
    assert body["critical_waiting"] == {"count": 0, "oldest_created_at": None}
    assert body["parcels_complete"] == {
        "window_days": TILE_WINDOW_DAYS, "loaded_trip_count": 0, "complete_trip_count": 0,
        "complete_rate": None,
    }
    assert body["receipts_owed"] == {"pending_count": 0, "failed_count": 0}
    # The seeded driver and horse have no expiry date on file.
    assert body["licence_expiry"] == {"drivers": _bands(no_date=1), "vehicle_discs": _bands(no_date=1)}
    # An active horse that has never had a trip is unused.
    assert [row["vehicle_id"] for row in body["unused_vehicles"]["vehicles"]] == [str(operator.horse.id)]
    assert body["all_time_start"] == today_sast().isoformat()


async def test_fleet_tiles_live_trips_counts_created_active_and_held_trips(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    for status in (TripStatus.CREATED, TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD):
        await seed_trip(db_session, operator, stops=stops, start=days_ago(1), status=status, steps=not_started())
    for status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        await seed_trip(db_session, operator, stops=stops, start=days_ago(2), status=status)

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["live_trips"] == 3


async def test_fleet_tiles_critical_waiting_counts_only_critical_needs_review(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    trip = (await seed_trip(db_session, operator, stops=stops, start=days_ago(6))).trip
    oldest = days_ago(3)
    for created_at, severity, review_status in (
        (oldest, ExceptionSeverity.CRITICAL, ExceptionReviewStatus.NEEDS_REVIEW),
        (days_ago(1), ExceptionSeverity.CRITICAL, ExceptionReviewStatus.NEEDS_REVIEW),
        (days_ago(5), ExceptionSeverity.CRITICAL, ExceptionReviewStatus.REVIEWED),
        (days_ago(5), ExceptionSeverity.WARNING, ExceptionReviewStatus.NEEDS_REVIEW),
    ):
        await add_exception(
            db_session, trip, exception_type=ExceptionType.SEAL_MISMATCH, severity=severity,
            review_status=review_status, created_at=created_at,
        )

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    waiting = response.json()["critical_waiting"]
    assert waiting["count"] == 2
    assert datetime.fromisoformat(waiting["oldest_created_at"]) == oldest


async def test_fleet_tiles_parcels_complete_counts_loaded_closed_trips_in_the_window(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    today = today_sast()
    first_window_day = today - timedelta(days=TILE_WINDOW_DAYS - 1)
    # (departure, trip type, status, exception raised on it)
    cases = (
        (days_ago(5), TripType.LOADED, TripStatus.CLOSED, ExceptionType.SEAL_MISMATCH),  # complete
        (days_ago(3), TripType.LOADED, TripStatus.CLOSED, ExceptionType.WAYBILL_COUNT_MISMATCH),
        (days_ago(2), TripType.LOADED, TripStatus.CLOSED, ExceptionType.PARCEL_COUNT_MISMATCH),
        (at_sast(first_window_day, 0, 30), TripType.LOADED, TripStatus.CLOSED, None),  # complete
        (at_sast(first_window_day - timedelta(days=1), 23, 30), TripType.LOADED, TripStatus.CLOSED, None),
        (days_ago(4), TripType.EMPTY_LEG, TripStatus.CLOSED, None),
        (days_ago(1), TripType.LOADED, TripStatus.ACTIVE, None),
    )
    for departed_at, trip_type, status, exception_type in cases:
        seeded = await seed_trip(
            db_session, operator, stops=stops, start=start_for_departure(departed_at),
            trip_type=trip_type, status=status,
        )
        if exception_type is not None:
            await add_exception(
                db_session, seeded.trip, exception_type=exception_type,
                severity=ExceptionSeverity.WARNING, created_at=departed_at,
            )

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    parcels = response.json()["parcels_complete"]
    assert (parcels["loaded_trip_count"], parcels["complete_trip_count"]) == (4, 2)
    assert parcels["complete_rate"] == pytest.approx(0.5)


async def test_fleet_tiles_receipts_owed_counts_only_attested_anchored_steps(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    owed = replace_step(SINGLE_LEG, PhaseType.DEPARTURE, anchor_status=AnchorStatus.PENDING)
    owed = replace_step(owed, PhaseType.CONFIRMATION, anchor_status=AnchorStatus.FAILED)
    await seed_trip(db_session, operator, stops=stops, start=days_ago(4), steps=owed)
    # Future plan steps: receipts pending by design, not owed.
    await seed_trip(
        db_session, operator, stops=stops, start=days_ago(1), status=TripStatus.CREATED,
        steps=not_started(),
    )
    # An overridden departure is never anchored, so its pending receipt is not owed either.
    overridden = replace_step(
        not_started(), PhaseType.DEPARTURE,
        status=PhaseStatus.OVERRIDDEN, anchor_status=AnchorStatus.PENDING,
    )
    await seed_trip(
        db_session, operator, stops=stops, start=days_ago(1), status=TripStatus.ACTIVE,
        steps=overridden,
    )

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["receipts_owed"] == {"pending_count": 1, "failed_count": 1}


async def test_fleet_tiles_licence_expiry_bands_are_separate_and_active_only(
    client: AsyncClient, db_session: AsyncSession, operator: Operator,
) -> None:
    today = today_sast()
    org_id = operator.org.id
    drivers = [
        new_driver(org_id, license_expiry=today + timedelta(days=days_left))
        for days_left in (-1, 0, 30, 31, 90, 91, 180, 181)
    ]
    drivers += [
        new_driver(org_id, license_expiry=None),
        new_driver(org_id, license_expiry=today - timedelta(days=1), is_active=False),
    ]
    vehicles = [
        new_vehicle(org_id, VehicleType.TRAILER, licence_disc_expiry=today - timedelta(days=10)),
        new_vehicle(org_id, VehicleType.HORSE, licence_disc_expiry=today + timedelta(days=10)),
        new_vehicle(
            org_id, VehicleType.TRAILER, licence_disc_expiry=today - timedelta(days=10), is_active=False,
        ),
    ]
    db_session.add_all([*drivers, *vehicles])
    await db_session.flush()

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    expiry = response.json()["licence_expiry"]
    # The seeded driver and horse add one "no date" each.
    assert expiry["drivers"] == _bands(
        expired=1, within_30_days=2, within_90_days=2, within_180_days=2, no_date=2,
    )
    assert expiry["vehicle_discs"] == _bands(expired=1, within_30_days=1, no_date=1)


async def test_fleet_tiles_unused_vehicles_had_no_recent_or_live_trip(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    org_id = operator.org.id
    recent_trailer = new_vehicle(org_id, VehicleType.TRAILER)
    live_horse = new_vehicle(org_id, VehicleType.HORSE)
    cancelled_horse = new_vehicle(org_id, VehicleType.HORSE)
    old_horse = new_vehicle(org_id, VehicleType.HORSE)
    idle_trailer = new_vehicle(org_id, VehicleType.TRAILER)
    inactive_horse = new_vehicle(org_id, VehicleType.HORSE, is_active=False)
    db_session.add_all([recent_trailer, live_horse, cancelled_horse, old_horse, idle_trailer, inactive_horse])
    await db_session.flush()
    await other_operator(db_session)
    await seed_trip(
        db_session, operator, stops=stops, start=start_for_departure(days_ago(5)),
        trailers=[recent_trailer],
    )
    await seed_trip(
        db_session, operator, stops=stops, start=days_ago(1), status=TripStatus.CREATED,
        steps=not_started(), horse=live_horse,
    )
    await seed_trip(
        db_session, operator, stops=stops, start=start_for_departure(days_ago(3)),
        status=TripStatus.CANCELLED, horse=cancelled_horse,
    )
    await seed_trip(
        db_session, operator, stops=stops, start=start_for_departure(days_ago(40)), horse=old_horse,
    )

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    unused = response.json()["unused_vehicles"]
    assert unused["window_days"] == TILE_WINDOW_DAYS
    # Ordered horses first, then trailers.
    assert unused["vehicles"] == [
        {"vehicle_id": str(old_horse.id), "registration": old_horse.registration, "vehicle_type": "horse"},
        {"vehicle_id": str(idle_trailer.id), "registration": idle_trailer.registration, "vehicle_type": "trailer"},
    ]


async def test_fleet_tiles_never_count_another_operators_data(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    other = await other_operator(db_session)
    owed = replace_step(SINGLE_LEG, PhaseType.DEPARTURE, anchor_status=AnchorStatus.FAILED)
    closed = await seed_trip(
        db_session, other, stops=stops, start=start_for_departure(days_ago(2)), steps=owed,
    )
    await add_exception(
        db_session, closed.trip, exception_type=ExceptionType.PANIC_BUTTON,
        severity=ExceptionSeverity.CRITICAL, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
        created_at=days_ago(2),
    )
    await seed_trip(
        db_session, other, stops=stops, start=days_ago(1), status=TripStatus.CREATED, steps=not_started(),
    )
    db_session.add(new_driver(other.org.id, license_expiry=today_sast() - timedelta(days=3)))
    await db_session.flush()

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert body["live_trips"] == 0
    assert body["critical_waiting"]["count"] == 0
    assert body["parcels_complete"]["loaded_trip_count"] == 0
    assert body["receipts_owed"] == {"pending_count": 0, "failed_count": 0}
    assert body["licence_expiry"]["drivers"] == _bands(no_date=1)
    assert [row["vehicle_id"] for row in body["unused_vehicles"]["vehicles"]] == [str(operator.horse.id)]
    assert body["all_time_start"] == today_sast().isoformat()


async def test_fleet_tiles_all_time_starts_on_the_first_trip_day(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await seed_trip(db_session, operator, stops=stops, start=days_ago(3))
    await seed_trip(db_session, operator, stops=stops, start=days_ago(20), status=TripStatus.CANCELLED)

    response = await client.get(_TILES, headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["all_time_start"] == (today_sast() - timedelta(days=20)).isoformat()
