"""Integration tests for GET /api/v1/trips/{trip_id}/artifacts (dispatcher evidence list)."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import AsyncClient, ConnectError
from sqlalchemy.ext.asyncio import AsyncSession
from storage3.exceptions import StorageApiError

from app.db.models.enums import ArtifactType, IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.storage import supabase_storage

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def stub_signed_urls(monkeypatch):
    """Storage is out of scope for endpoint tests — signing itself is covered elsewhere."""
    async def _fake(*, s3_bucket, s3_key, ttl_seconds):
        return f"https://storage.test/{s3_key}?ttl={ttl_seconds}"
    monkeypatch.setattr("app.orchestration.evidence.artifacts.create_signed_url", _fake)


@pytest_asyncio.fixture
async def seed_trip_with_artifacts(db_session):
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
        id=uuid.uuid4(), trip_reference="FP-TEST-TA", order_number="ORD-TA",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    seal_photo = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip.id}/seal", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_by_driver_id=driver.id, captured_at=datetime(2026, 7, 30, 8, 0, tzinfo=UTC),
    )
    pod = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.DOCUMENT,
        s3_key=f"{trip.id}/pod", s3_bucket="evidence-artifacts",
        file_hash="b" * 64, mime_type="application/pdf",
        captured_by_driver_id=driver.id, captured_at=datetime(2026, 7, 30, 14, 0, tzinfo=UTC),
    )
    db_session.add_all([seal_photo, pod])
    await db_session.flush()
    return trip, user, org, seal_photo, pod


@pytest.mark.asyncio
async def test_list_artifacts_returns_signed_urls_in_capture_order(client: AsyncClient, seed_trip_with_artifacts):
    trip, user, org, seal_photo, pod = seed_trip_with_artifacts
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code == 200
    body = response.json()
    assert [a["id"] for a in body] == [str(seal_photo.id), str(pod.id)]
    assert body[0]["signed_url"] == f"https://storage.test/{trip.id}/seal?ttl=300"
    assert body[0]["file_hash"] == "a" * 64


@pytest.mark.parametrize("failure", [
    StorageApiError("Object not found", "not_found", 404),
    ConnectError("Storage unavailable"),
])
async def test_list_artifacts_keeps_metadata_and_other_photos_when_one_cannot_be_signed(
    client: AsyncClient, seed_trip_with_artifacts: tuple[Trip, User, Organization, EvidenceArtifact, EvidenceArtifact],
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, failure: Exception,
) -> None:
    trip, user, org, seal_photo, pod = seed_trip_with_artifacts
    unavailable_key = seal_photo.s3_key

    def sign(path: str, expires_in: int) -> dict[str, str]:
        if path == unavailable_key:
            raise failure
        return {"signedURL": f"https://storage.test/{path}?ttl={expires_in}"}

    bucket = SimpleNamespace(create_signed_url=sign)
    sdk = SimpleNamespace(storage=SimpleNamespace(from_=lambda _: bucket))
    monkeypatch.setattr(supabase_storage, "_get_client", lambda: sdk)
    monkeypatch.setattr(supabase_storage, "_SIGNING_CLIENTS", type(supabase_storage._SIGNING_CLIENTS)())
    monkeypatch.setattr("app.orchestration.evidence.artifacts.create_signed_url", supabase_storage.create_signed_url)
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    response = await client.get(
        f"/api/v1/trips/{trip.id}/artifacts", headers={**auth_header(token), "Origin": "http://localhost:3000"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    body = response.json()
    assert [artifact["id"] for artifact in body] == [str(seal_photo.id), str(pod.id)]
    assert body[0]["signed_url"] is None
    assert body[0]["file_hash"] == seal_photo.file_hash
    assert body[1]["signed_url"] == f"https://storage.test/{trip.id}/pod?ttl=300"
    await db_session.refresh(seal_photo)
    assert seal_photo.file_hash == "a" * 64


@pytest.mark.asyncio
async def test_list_artifacts_requires_auth(client: AsyncClient, seed_trip_with_artifacts):
    trip, *_ = seed_trip_with_artifacts

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts")

    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_artifacts_404s_for_unknown_trip(client: AsyncClient, seed_trip_with_artifacts):
    _, user, org, *_ = seed_trip_with_artifacts
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    response = await client.get(f"/api/v1/trips/{uuid.uuid4()}/artifacts", headers=auth_header(token))

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_artifacts_404s_across_organisations(client: AsyncClient, db_session, seed_trip_with_artifacts):
    """Another operator's trip must be indistinguishable from a nonexistent one."""
    trip, *_ = seed_trip_with_artifacts
    other_org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_user = User(id=uuid.uuid4(), organization_id=other_org.id, email="o@test.co.za", full_name="O")
    db_session.add(other_user)
    await db_session.flush()
    token = make_token(sub=str(other_user.id), role="dispatcher", org_id=str(other_org.id))

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_artifacts_rejects_a_driver(client: AsyncClient, seed_trip_with_artifacts):
    """Drivers must never enumerate a trip's evidence."""
    trip, *_ = seed_trip_with_artifacts
    token = make_token(sub=str(uuid.uuid4()), role="driver")

    response = await client.get(f"/api/v1/trips/{trip.id}/artifacts", headers=auth_header(token))

    assert response.status_code in (401, 403)
