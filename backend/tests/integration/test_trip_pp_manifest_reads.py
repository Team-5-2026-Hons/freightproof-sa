"""Order number gone, manifest key shown: the read side of FP-281 (spec §6, §12)."""

from httpx import AsyncClient
from collections.abc import AsyncIterator

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import TripStatus
from app.db.models.trips import Trip
from app.db.session import get_db
from app.main import app
from tests.integration._pp_manifest_world import (
    MOCK_CLIENT_NAME, build_manifest_world, insert_trip,
)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def test_post_trips_ignores_a_legacy_order_number(client: AsyncClient, db_session: AsyncSession) -> None:
    """A browser still on the old wizard during the A+B deploy sends one; it must not be rejected."""
    world = await build_manifest_world(db_session)
    payload = {
        "order_number": "ORD-LEGACY-1",
        "driver_id": str(world.driver.id), "horse_id": str(world.horse.id), "trailer_ids": [],
        "origin_precinct_id": str(world.cape_town.id),
        "destination_precinct_id": str(world.johannesburg.id),
        "trip_type": "empty_leg", "planned_departure_at": datetime.now(UTC).isoformat(),
    }

    resp = await client.post("/api/v1/trips", json=payload, headers=world.headers())

    assert resp.status_code == 201, resp.text
    assert "order_number" not in resp.json()
    assert resp.json()["pp_manifest"] is None
    trip = (await db_session.execute(
        select(Trip).where(Trip.id == uuid.UUID(resp.json()["id"]))
    )).scalar_one()
    assert trip.order_number is None


async def test_list_filters_by_exact_manifest_number(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    wanted = await insert_trip(db_session, world, number=69)
    await insert_trip(db_session, world, number=690)

    resp = await client.get(
        "/api/v1/trips", params={"pp_manifest_number": 69}, headers=world.headers(),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [row["id"] for row in body] == [str(wanted.id)]
    assert body[0]["pp_manifest"] == {
        "issuer_account": world.client.pp_account_number, "origin_hub": "CPT",
        "number": 69, "display": f"{MOCK_CLIENT_NAME} · CPT 69",
    }
    assert "order_number" not in body[0]


async def test_list_item_without_a_manifest_has_null_pp_manifest(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=None)

    resp = await client.get("/api/v1/trips", headers=world.headers())

    assert resp.json()[0]["pp_manifest"] is None


async def test_history_search_matches_manifest_number_exactly(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    closed_at = datetime.now(UTC)
    wanted = await insert_trip(
        db_session, world, number=69, status=TripStatus.CLOSED, closed_at=closed_at,
    )
    await insert_trip(db_session, world, number=690, status=TripStatus.CLOSED, closed_at=closed_at)

    resp = await client.get("/api/v1/trips/history", params={"q": "69"}, headers=world.headers())

    assert resp.status_code == 200, resp.text
    assert [item["id"] for item in resp.json()["items"]] == [str(wanted.id)]


async def test_history_search_with_an_overlong_number_is_empty_not_an_error(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    resp = await client.get(
        "/api/v1/trips/history", params={"q": "9" * 20}, headers=world.headers(),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []


async def test_history_search_still_matches_trip_reference(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(
        db_session, world, number=None, status=TripStatus.CLOSED, closed_at=datetime.now(UTC),
    )

    resp = await client.get(
        "/api/v1/trips/history", params={"q": trip.trip_reference[-6:]}, headers=world.headers(),
    )

    assert [item["id"] for item in resp.json()["items"]] == [str(trip.id)]


async def test_detail_carries_the_manifest_display(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(db_session, world, number=81)

    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=world.headers())

    assert resp.status_code == 200, resp.text
    assert resp.json()["pp_manifest"]["display"] == f"{MOCK_CLIENT_NAME} · CPT 81"
    assert "order_number" not in resp.json()


async def test_driver_trip_list_shows_reference_not_order_number(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(db_session, world, number=81)

    resp = await client.get("/api/v1/trips/me", headers=world.driver_headers())

    assert resp.status_code == 200, resp.text
    row = resp.json()[0]
    assert row["trip_reference"] == trip.trip_reference
    assert "order_number" not in row


@pytest.mark.parametrize("query", ["²", "①"])
async def test_history_search_non_decimal_digits_are_text(
    client: AsyncClient, db_session: AsyncSession, query: str,
) -> None:
    world = await build_manifest_world(db_session)

    response = await client.get("/api/v1/trips/history", params={"q": query}, headers=world.headers())

    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


async def test_history_search_accepts_decimal_unicode_digits(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    wanted = await insert_trip(db_session, world, number=69, status=TripStatus.CLOSED, closed_at=datetime.now(UTC))

    response = await client.get("/api/v1/trips/history", params={"q": "٦٩"}, headers=world.headers())

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [str(wanted.id)]
