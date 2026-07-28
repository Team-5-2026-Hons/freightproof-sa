"""Integration tests for FP-112 multi-stop trip creation (POST /api/v1/trips).

Uses a real PostgreSQL test database (TEST_DATABASE_URL) and a rolled-back
transaction per test, same pattern as test_trips.py. Auth via a real signed
JWT (see tests/conftest.py) through the shared `client` fixture.
"""

import uuid
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.db.models.trips import TripStop
from app.db.models.enums import IdvsStatus, OrganizationType, VehicleType
from app.db.session import get_db

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_data(db_session: AsyncSession):
    """Insert the minimal rows required by POST /trips, plus a third precinct
    for multi-stop routes, and yield their IDs."""

    operator_org = Organization(
        id=uuid.uuid4(), name="Demo Operator", org_type=OrganizationType.OPERATOR
    )
    client_org = Organization(
        id=uuid.uuid4(), name="Demo Client", org_type=OrganizationType.PRINCIPAL
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    origin = Precinct(
        id=uuid.uuid4(), name="Cape Town Depot",
        principal_organization_id=client_org.id, latitude="33.9249", longitude="18.4241",
    )
    midpoint = Precinct(
        id=uuid.uuid4(), name="Bloemfontein Depot",
        principal_organization_id=client_org.id, latitude="29.0852", longitude="26.1596",
    )
    destination = Precinct(
        id=uuid.uuid4(), name="Johannesburg Depot",
        principal_organization_id=client_org.id, latitude="26.2041", longitude="28.0473",
    )
    db_session.add_all([origin, midpoint, destination])
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(), organization_id=operator_org.id, full_name="Test Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-001", idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator_org.id, registration="CA 123-456",
        vehicle_type=VehicleType.HORSE, pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=operator_org.id, registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER, pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    yield {
        "org": operator_org,
        "user": user,
        "client_org_id": client_org.id,
        "origin_id": origin.id,
        "midpoint_id": midpoint.id,
        "destination_id": destination.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "trailer_id": trailer.id,
    }


def _single_leg_payload(seed: dict, order_number: str = "ORD-SINGLE-001") -> dict:
    return {
        "order_number": order_number,
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
    }


def _multi_stop_payload(seed: dict, order_number: str = "ORD-MULTI-001") -> dict:
    return {
        "order_number": order_number,
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "stops": [
            {"precinct_id": str(seed["origin_id"]), "sequence": 0},
            {"precinct_id": str(seed["midpoint_id"]), "sequence": 1},
            {"precinct_id": str(seed["destination_id"]), "sequence": 2},
        ],
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
    }


def _auth_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id))
    )


# ─── Single-leg back-compat (stops omitted) ────────────────────────────────

async def test_single_leg_create_synthesises_two_stops(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips", json=_single_leg_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["stops"]) == 2
    assert body["stops"][0]["sequence"] == 0
    assert body["stops"][0]["precinct_id"] == str(seed_data["origin_id"])
    assert body["stops"][1]["sequence"] == 1
    assert body["stops"][1]["precinct_id"] == str(seed_data["destination_id"])
    assert body["origin_precinct_id"] == str(seed_data["origin_id"])
    assert body["destination_precinct_id"] == str(seed_data["destination_id"])


async def test_single_leg_create_persists_two_tripstop_rows(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips", json=_single_leg_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = uuid.UUID(resp.json()["id"])

    rows = (
        await db_session.execute(
            select(TripStop).where(TripStop.trip_id == trip_id).order_by(TripStop.sequence)
        )
    ).scalars().all()
    assert len(rows) == 2
    assert rows[0].precinct_id == seed_data["origin_id"]
    assert rows[1].precinct_id == seed_data["destination_id"]


# ─── Explicit multi-stop route ─────────────────────────────────────────────

async def test_multi_stop_create_persists_stops_in_order(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips", json=_multi_stop_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["stops"]) == 3
    assert [s["sequence"] for s in body["stops"]] == [0, 1, 2]
    assert [s["precinct_id"] for s in body["stops"]] == [
        str(seed_data["origin_id"]), str(seed_data["midpoint_id"]), str(seed_data["destination_id"])
    ]


async def test_multi_stop_create_derives_trip_origin_and_destination(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips", json=_multi_stop_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    body = resp.json()
    assert body["origin_precinct_id"] == str(seed_data["origin_id"])
    assert body["destination_precinct_id"] == str(seed_data["destination_id"])


async def test_multi_stop_create_without_client_organization_id_succeeds(client: AsyncClient, seed_data, db_session):
    """A multi-stop trip has no single client_organization_id (FP-112 A.2)."""
    payload = _multi_stop_payload(seed_data)
    assert "client_organization_id" not in payload
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201


# ─── Trip-detail read includes stops ───────────────────────────────────────

async def test_get_trip_detail_returns_stops(client: AsyncClient, seed_data, db_session):
    create_resp = await client.post(
        "/api/v1/trips", json=_single_leg_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = create_resp.json()["id"]
    resp = await client.get(
        f"/api/v1/trips/{trip_id}", headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["stops"]) == 2
    assert body["stops"][0]["sequence"] == 0
    assert body["stops"][1]["sequence"] == 1
