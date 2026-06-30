"""Integration tests for POST /api/v1/artifacts (driver evidence upload)."""

import io
import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_trip(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-ART", order_number="ORD-ART",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_upload_artifact_returns_201_with_id(client: AsyncClient, seed_trip, monkeypatch):
    from app.storage.supabase_storage import UploadResult

    trip, driver = seed_trip

    async def fake_upload(*, trip_id, file_bytes, mime_type):
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/x", file_hash="a" * 64)

    monkeypatch.setattr("app.orchestration.artifact_service.upload_evidence_file", fake_upload)

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", io.BytesIO(b"fakejpegbytes"), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "id" in body
    assert body["file_hash"] == "a" * 64


async def test_upload_artifact_over_10mb_returns_422(client: AsyncClient, seed_trip):
    trip, driver = seed_trip

    token = make_token(sub=str(driver.id), role="driver")
    big = io.BytesIO(b"0" * (10 * 1024 * 1024 + 1))
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("big.jpg", big, "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 422


async def test_upload_artifact_for_someone_elses_trip_returns_403(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip
    org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", io.BytesIO(b"fakejpegbytes"), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 403
