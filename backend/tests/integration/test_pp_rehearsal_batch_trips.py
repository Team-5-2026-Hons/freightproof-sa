"""The rehearsal batch (manifests 101-130) through the real preview and create endpoints.

The three local precincts are made by hand in the dispatcher and no endpoint sets
pp_hub_code, so their hubs preview as unlinked and the presenter picks the precinct. If a
database owner links them (pp_hub_code CAV / UCN / UCS), the existing automatic mapping
takes over; both paths are exercised here. Nothing leaves the test database and the PP mock
is held in memory.
"""

import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pytest import MonkeyPatch
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ParcelStatus, TripStatus
from app.db.models.organisations import Precinct
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.session import get_db
from app.integrations.parcel_perfect.manifest_fixtures import REHEARSAL_BATCH_MANIFESTS
from app.main import app
from tests.conftest import FakeMockStateStore
from tests.integration._pp_manifest_world import (
    ManifestWorld, build_manifest_world, create_body, install_pp_mock, preview,
)

_CREATE = "/api/v1/trips/from-pp-manifest"

_LOCAL_SAMPLE = (101, 107, 113, 119)
_NATIONAL = tuple(range(125, 131))
_UNLINKED = {"ORIGIN_HUB_UNLINKED", "DESTINATION_HUB_UNLINKED"}


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


async def _precincts(
    db: AsyncSession, world: ManifestWorld, *, link_local: bool,
) -> dict[str, Precinct]:
    """The client's precincts for hubs the base world lacks, keyed by hub code. The three
    local ones are unlinked unless link_local, matching how they exist in the real database."""
    suffix = uuid.uuid4().hex[:8]
    specs = {"BFN": "Bloemfontein Depot", "CAV": "Cavendish", "UCN": "UCT North Stop", "UCS": "UCT South Stop"}
    precincts = {
        hub: Precinct(
            id=uuid.uuid4(), name=f"{name} {suffix}", principal_organization_id=world.client.id,
            latitude="0", longitude="0", is_shared=True,
            pp_hub_code=hub if hub == "BFN" or link_local else None,
        )
        for hub, name in specs.items()
    }
    db.add_all(precincts.values())
    await db.flush()
    return precincts | {"CPT": world.cape_town, "JNB": world.johannesburg}


def _codes(body: dict) -> dict[str, bool]:
    return {w["code"]: w["blocking"] for w in body["warnings"]}


@pytest.mark.parametrize("number", _LOCAL_SAMPLE)
async def test_local_manifest_previews_with_unlinked_hub_prompts_only(
    client: AsyncClient, db_session: AsyncSession, number: int,
) -> None:
    world = await build_manifest_world(db_session)
    await _precincts(db_session, world, link_local=False)
    fixture = REHEARSAL_BATCH_MANIFESTS[number]

    body = await preview(client, world, number)

    assert body["can_create"] is True
    assert _codes(body) == {code: False for code in _UNLINKED}
    assert body["origin"] == {"hub_code": fixture.origin.hub_code, "precinct_id": None, "precinct_name": None}
    assert body["destination"]["hub_code"] == fixture.destination.hub_code
    assert body["destination"]["precinct_id"] is None
    assert body["is_closed"] is True
    assert body["totals"]["waybills"] == len(fixture.lines)
    assert body["totals"]["parcels"] == sum(line.parcel_count for line in fixture.lines)


@pytest.mark.parametrize("number", _LOCAL_SAMPLE)
async def test_local_manifest_without_a_precinct_pick_is_refused(
    client: AsyncClient, db_session: AsyncSession, number: int,
) -> None:
    world = await build_manifest_world(db_session)
    await _precincts(db_session, world, link_local=False)

    resp = await client.post(_CREATE, json=create_body(world, await preview(client, world, number)), headers=world.headers())

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "PRECINCT_REQUIRED"
    assert (await db_session.execute(select(func.count(Trip.id)))).scalar_one() == 0


@pytest.mark.parametrize("number", _LOCAL_SAMPLE)
async def test_local_manifest_creates_a_clean_trip_on_the_picked_precincts(
    client: AsyncClient, db_session: AsyncSession, number: int,
) -> None:
    world = await build_manifest_world(db_session)
    precincts = await _precincts(db_session, world, link_local=False)
    fixture = REHEARSAL_BATCH_MANIFESTS[number]
    origin, destination = precincts[fixture.origin.hub_code], precincts[fixture.destination.hub_code]
    previewed = await preview(client, world, number)

    resp = await client.post(_CREATE, headers=world.headers(), json=create_body(
        world, previewed,
        origin_precinct_id=str(origin.id), destination_precinct_id=str(destination.id),
    ))

    assert resp.status_code == 201, resp.text
    trip = (await db_session.execute(select(Trip).where(Trip.id == uuid.UUID(resp.json()["id"])))).scalar_one()
    assert trip.status == TripStatus.CREATED
    assert (trip.origin_precinct_id, trip.destination_precinct_id) == (origin.id, destination.id)
    assert trip.pp_manifest_number == number
    assert trip.pp_manifest_origin_hub == fixture.origin.hub_code
    refs = (await db_session.execute(
        select(Consignment.parcel_perfect_reference).where(Consignment.trip_id == trip.id)
    )).scalars().all()
    assert sorted(refs) == [f"MFTWB{number}{p:02d}" for p in range(1, len(fixture.lines) + 1)]
    statuses = (await db_session.execute(
        select(Parcel.status).join(Consignment, Parcel.consignment_id == Consignment.id)
        .where(Consignment.trip_id == trip.id)
    )).scalars().all()
    assert len(statuses) == sum(line.parcel_count for line in fixture.lines)
    assert set(statuses) == {ParcelStatus.PENDING}
    assert (await db_session.execute(
        select(func.count(TripException.id)).where(TripException.trip_id == trip.id)
    )).scalar_one() == 0


async def test_a_local_manifest_cannot_start_and_end_at_the_same_precinct(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    precincts = await _precincts(db_session, world, link_local=False)
    previewed = await preview(client, world, 113)
    north = str(precincts["UCN"].id)

    resp = await client.post(_CREATE, headers=world.headers(), json=create_body(
        world, previewed, origin_precinct_id=north, destination_precinct_id=north,
    ))

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "SAME_PRECINCT"


async def test_local_hubs_linked_by_the_database_owner_map_automatically(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    precincts = await _precincts(db_session, world, link_local=True)
    previewed = await preview(client, world, 119)

    resp = await client.post(_CREATE, json=create_body(world, previewed), headers=world.headers())

    assert previewed["warnings"] == []
    assert previewed["origin"]["precinct_id"] == str(precincts["UCN"].id)
    assert previewed["destination"]["precinct_id"] == str(precincts["UCS"].id)
    assert resp.status_code == 201, resp.text
    trip = (await db_session.execute(select(Trip).where(Trip.id == uuid.UUID(resp.json()["id"])))).scalar_one()
    assert (trip.origin_precinct_id, trip.destination_precinct_id) == (precincts["UCN"].id, precincts["UCS"].id)


@pytest.mark.parametrize("number", _NATIONAL)
async def test_national_manifest_maps_to_its_seeded_depots_with_no_prompts(
    client: AsyncClient, db_session: AsyncSession, number: int,
) -> None:
    world = await build_manifest_world(db_session)
    precincts = await _precincts(db_session, world, link_local=False)
    fixture = REHEARSAL_BATCH_MANIFESTS[number]

    body = await preview(client, world, number)

    assert body["warnings"] == []
    assert body["can_create"] is True
    assert body["origin"]["precinct_id"] == str(precincts[fixture.origin.hub_code].id)
    assert body["destination"]["precinct_id"] == str(precincts[fixture.destination.hub_code].id)


async def test_a_national_manifest_creates_a_trip_with_no_picks(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    precincts = await _precincts(db_session, world, link_local=False)

    resp = await client.post(_CREATE, json=create_body(world, await preview(client, world, 129)), headers=world.headers())

    assert resp.status_code == 201, resp.text
    trip = (await db_session.execute(select(Trip).where(Trip.id == uuid.UUID(resp.json()["id"])))).scalar_one()
    assert (trip.origin_precinct_id, trip.destination_precinct_id) == (precincts["BFN"].id, precincts["JNB"].id)


async def test_every_batch_manifest_previews_creatable(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await _precincts(db_session, world, link_local=False)

    for number, fixture in REHEARSAL_BATCH_MANIFESTS.items():
        body = await preview(client, world, number)

        assert body["can_create"] is True, number
        expected = _UNLINKED if {fixture.origin.hub_code, fixture.destination.hub_code} <= {"CAV", "UCN", "UCS"} else set()
        assert set(_codes(body)) == expected, number
        assert not any(_codes(body).values()), number
