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

# A real JPEG signature (SOI + APP0), padded. The upload path re-derives the content type
# from the bytes rather than trusting the client's declared one — see
# app/storage/mime_allowlist.py — so a placeholder like b"fakejpegbytes" is now correctly
# rejected as "not any allowed format". Tests that want a successful upload have to send
# something that genuinely looks like an image.
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 32


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
        files={"file": ("gate.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "id" in body
    assert body["file_hash"] == "a" * 64


async def test_upload_artifact_over_10mb_returns_413(client: AsyncClient, seed_trip):
    """413, not 422, since the size is now rejected from the declared content length
    BEFORE the body is read — which is the point: an oversized upload no longer has to be
    spooled to disk in full just to be measured and thrown away.

    413 is also what the driver app already models for this case: it raises a synthetic
    ApiError(413) client-side (lib/api/artifacts.ts) precisely so an oversized photo is
    treated as TERMINAL rather than queued for retry (isQueueableFailure retries only
    status 0 and >=500). A real 413 from the server now takes the same path; a 422 would
    have been a second, inconsistent code for one condition.
    """
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
    assert resp.status_code == 413


async def test_upload_of_html_labelled_as_a_photo_is_refused(client: AsyncClient, seed_trip):
    """The stored-XSS path this endpoint used to leave open.

    The content type was taken from the client and written straight onto the Storage
    object, so a handset could store a page as "evidence" and the dispatcher's browser
    would render it when they opened the signed URL. The type is now re-derived from the
    bytes, so the declared `image/jpeg` no longer buys anything.
    """
    trip, driver = seed_trip

    token = make_token(sub=str(driver.id), role="driver")
    html = io.BytesIO(b"<html><script>alert(document.cookie)</script></html>")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", html, "image/jpeg")},
        headers=auth_header(token),
    )

    assert resp.status_code == 422
    assert "Unsupported file type" in resp.json()["detail"]


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
        files={"file": ("gate.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 403
