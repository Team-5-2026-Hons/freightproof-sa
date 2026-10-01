"""The H0 snapshot holds the whole PP manifest, so it is dispatcher-only (spec §7.3, §12)."""

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


async def test_dispatcher_manifest_view_carries_the_snapshot(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _manifest_trip(client, world)

    resp = await client.get(f"/api/v1/trips/{trip_id}/manifest", headers=world.headers())

    assert resp.status_code == 200, resp.text
    assert resp.json()["pp_manifest_snapshot"]["header"]["manifest_number"] == MANIFEST_HAPPY_PATH


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
    assert resp.json()["pp_manifest_snapshot"]["header"]["manifest_number"] == MANIFEST_HAPPY_PATH
