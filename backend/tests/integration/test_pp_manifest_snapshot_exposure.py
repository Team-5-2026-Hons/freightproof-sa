"""The H0 snapshot holds the whole PP manifest, so it is dispatcher-only (spec §7.3, §12).
The manifest key is dispatcher context too: the driver app identifies a trip by its
trip_reference."""

from httpx import AsyncClient
from collections.abc import AsyncIterator
from tests.conftest import FakeMockStateStore
from tests.integration._pp_manifest_world import ManifestWorld
from pytest import MonkeyPatch

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH
from app.main import app
from app.orchestration.trip_service import cancel_trip
from tests.integration._pp_manifest_world import (
    build_manifest_world, create_body, install_pp_mock, preview,
)

_SNAPSHOT_FIELD = "parcel_manifest_snapshot"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def pp_mock(monkeypatch: MonkeyPatch) -> FakeMockStateStore:
    return install_pp_mock(monkeypatch)


async def _manifest_trip(client: AsyncClient, world: ManifestWorld) -> uuid.UUID:
    body = create_body(world, await preview(client, world, MANIFEST_HAPPY_PATH))
    resp = await client.post("/api/v1/trips/from-pp-manifest", json=body, headers=world.headers())
    assert resp.status_code == 201, resp.text
    assert _SNAPSHOT_FIELD not in resp.text
    return uuid.UUID(resp.json()["id"])


async def test_trip_detail_never_carries_the_snapshot(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _manifest_trip(client, world)

    dispatcher = await client.get(f"/api/v1/trips/{trip_id}", headers=world.headers())
    driver_headers = world.driver_headers()
    driver = await client.get("/api/v1/trips/me/active", headers=driver_headers)

    own = await client.get(f"/api/v1/trips/me/{trip_id}", headers=driver_headers)

    assert dispatcher.status_code == 200 and driver.status_code == 200 and own.status_code == 200
    assert _SNAPSHOT_FIELD not in own.text
    assert "pp_manifest_snapshot" not in own.text
    assert _SNAPSHOT_FIELD not in dispatcher.text
    assert _SNAPSHOT_FIELD not in driver.text
    assert "pp_manifest_snapshot" not in driver.text


async def test_driver_trip_views_carry_no_manifest_key(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _manifest_trip(client, world)

    driver_headers = world.driver_headers()  # one session: a second login signs the first out

    dispatcher = await client.get(f"/api/v1/trips/{trip_id}", headers=world.headers())
    active = await client.get("/api/v1/trips/me/active", headers=driver_headers)
    own = await client.get(f"/api/v1/trips/me/{trip_id}", headers=driver_headers)

    assert dispatcher.json()["pp_manifest"]["number"] == MANIFEST_HAPPY_PATH
    assert active.json()["id"] == str(trip_id)
    assert active.json()["pp_manifest"] is None
    assert own.json()["pp_manifest"] is None


async def test_dispatcher_manifest_view_shows_the_snapshot_as_previewed(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    previewed = await preview(client, world, MANIFEST_HAPPY_PATH)
    created = await client.post(
        "/api/v1/trips/from-pp-manifest", json=create_body(world, previewed), headers=world.headers(),
    )
    assert created.status_code == 201, created.text

    resp = await client.get(f"/api/v1/trips/{created.json()['id']}/manifest", headers=world.headers())

    assert resp.status_code == 200, resp.text
    snapshot = resp.json()["pp_manifest_snapshot"]
    # A display summary only: the stored JSON's receiver names and numbers stay in Postgres.
    assert set(snapshot) == {
        "manifest_number", "issuer_account", "issuer_name", "origin_hub", "destination_hub",
        "client_reference", "waybills", "totals",
    }
    assert snapshot["manifest_number"] == MANIFEST_HAPPY_PATH
    assert snapshot["client_reference"] == previewed["client_reference"]
    # One reading of a manifest: the panel shows the lines and totals the dispatcher reviewed.
    assert snapshot["waybills"] == previewed["waybills"]
    assert snapshot["totals"] == previewed["totals"]


async def test_driver_linehaul_view_has_no_snapshot(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _manifest_trip(client, world)

    resp = await client.get(f"/api/v1/trips/{trip_id}/manifest", headers=world.driver_headers())

    assert resp.status_code == 200, resp.text
    assert "pp_manifest_snapshot" not in resp.text


async def test_cancelled_trip_keeps_its_cargo_record_after_its_waybills_move(client: AsyncClient, db_session: AsyncSession) -> None:
    """Review Focus 4: the snapshot is the cancelled trip's only cargo record."""
    world = await build_manifest_world(db_session)
    first_id = await _manifest_trip(client, world)
    await cancel_trip(
        db_session, trip_id=first_id, operator_organization_id=world.operator.id,
        user_id=world.user.id, note="Horse broke down at the depot",
    )
    await _manifest_trip(client, world)

    resp = await client.get(f"/api/v1/trips/{first_id}/manifest", headers=world.headers())

    assert resp.status_code == 200, resp.text
    assert resp.json()["consignments"] == []
    assert resp.json()["pp_manifest_snapshot"]["manifest_number"] == MANIFEST_HAPPY_PATH
