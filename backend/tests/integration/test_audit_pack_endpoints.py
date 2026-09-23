"""Endpoint tests for the dispatcher-side Audit Pack routes."""

import hashlib
import io
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_packs import AuditPack
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from app.orchestration import audit_pack_service
from app.storage.supabase_storage import EvidenceStorageUnavailableError, UploadResult

from tests.conftest import auth_header, make_token
from tests.integration.audit_pack_seed import AuditTrip, seed_audit_trip

PREVIEW = "/api/v1/trips/{trip_id}/audit-trail/preview"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


def _admin(seed: AuditTrip) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed.dispatcher.id), role="admin_dispatcher", org_id=str(seed.org.id)))


async def test_preview_audit_trail_returns_manifest_for_admin(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(PREVIEW.format(trip_id=audit_trip.trip.id), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["trip"]["trip_reference"] == "FP-AUDIT"
    assert body["driver"]["id_number"] == "*********9087"
    assert len(body["phases"]) == 7
    assert body["observations"]


async def test_preview_audit_trail_applies_query_options(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(
        PREVIEW.format(trip_id=audit_trip.trip.id),
        params={"scope_consignment_id": str(audit_trip.consignment_a.id), "include_location_trail": "false",
                "include_full_driver_id": "true"},
        headers=_admin(audit_trip),
    )

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert [c["parcel_perfect_reference"] for c in body["consignments"]] == ["WAY-A"]
    assert body["location_trail"] == []
    assert body["driver"]["id_number"] == "8001015009087"


async def test_preview_audit_trail_rejects_non_admin_dispatcher(client: AsyncClient, audit_trip: AuditTrip):
    # Arrange
    token = make_token(sub=str(audit_trip.dispatcher.id), role="dispatcher", org_id=str(audit_trip.org.id))

    # Act
    response = await client.get(PREVIEW.format(trip_id=audit_trip.trip.id), headers=auth_header(token))

    # Assert
    assert response.status_code == 403


async def test_preview_audit_trail_rejects_expired_token(client: AsyncClient, audit_trip: AuditTrip):
    # Arrange
    token = make_token(sub=str(audit_trip.dispatcher.id), role="admin_dispatcher",
                       org_id=str(audit_trip.org.id), expires_in=-1)

    # Act
    response = await client.get(PREVIEW.format(trip_id=audit_trip.trip.id), headers=auth_header(token))

    # Assert
    assert response.status_code == 401


async def test_preview_audit_trail_unknown_trip_is_404(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(PREVIEW.format(trip_id=uuid.uuid4()), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 404


async def test_preview_audit_trail_consignment_not_on_trip_is_404(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(
        PREVIEW.format(trip_id=audit_trip.trip.id), params={"scope_consignment_id": str(uuid.uuid4())},
        headers=_admin(audit_trip),
    )

    # Assert
    assert response.status_code == 404


async def test_preview_audit_trail_malformed_trip_id_is_422(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(PREVIEW.format(trip_id="not-a-uuid"), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 422


PREVIEW_PDF = "/api/v1/trips/{trip_id}/audit-trail/preview.pdf"


async def test_preview_pdf_returns_pdf_marked_preview(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(PREVIEW_PDF.format(trip_id=audit_trip.trip.id), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "FP-AUDIT" in response.headers["content-disposition"]
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages)
    assert "FP-AUDIT" in text
    assert "PREVIEW" in text


async def test_preview_pdf_unknown_trip_is_404(client: AsyncClient, audit_trip: AuditTrip):
    # Act
    response = await client.get(PREVIEW_PDF.format(trip_id=uuid.uuid4()), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 404


async def test_preview_pdf_rejects_non_admin_dispatcher(client: AsyncClient, audit_trip: AuditTrip):
    # Arrange
    token = make_token(sub=str(audit_trip.dispatcher.id), role="dispatcher", org_id=str(audit_trip.org.id))

    # Act
    response = await client.get(PREVIEW_PDF.format(trip_id=audit_trip.trip.id), headers=auth_header(token))

    # Assert
    assert response.status_code == 403


# ── Issued packs ──────────────────────────────────────────────────────────────

PACKS = "/api/v1/trips/{trip_id}/audit-packs"
PACK = "/api/v1/audit-packs/{pack_id}"


@pytest.fixture
def pdf_store(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    store: dict[str, bytes] = {}

    async def fake_upload(*, trip_id: str, pack_id: str, pdf_bytes: bytes) -> UploadResult:
        key = f"audit-packs/{trip_id}/{pack_id}.pdf"
        store[key] = pdf_bytes
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=key, file_hash=hashlib.sha256(pdf_bytes).hexdigest())

    async def fake_download(*, s3_bucket: str, s3_key: str) -> bytes:
        return store[s3_key]

    monkeypatch.setattr(audit_pack_service, "upload_audit_pack_pdf", fake_upload)
    monkeypatch.setattr(audit_pack_service, "download_audit_pack_pdf", fake_download)
    return store


ISSUE_BODY = {
    "recipient_name": "Jane Adjuster", "recipient_organization": "Santam Claims",
    "purpose": "insurance_claim", "external_reference": "CLM-88123",
}


async def _issue_via_api(client: AsyncClient, seed: AuditTrip, **overrides: object) -> dict:
    response = await client.post(PACKS.format(trip_id=seed.trip.id), json={**ISSUE_BODY, **overrides},
                                 headers=_admin(seed))
    assert response.status_code == 201, response.text
    return response.json()


async def test_issue_pack_returns_token_once_with_links(client, audit_trip, pdf_store):
    # Act
    body = await _issue_via_api(client, audit_trip)

    # Assert
    assert body["pack"]["pack_label"] == "FP-AUDIT-AP1"
    assert body["pack"]["status"] == "active"
    assert body["pack"]["anchor_status"] == "anchored"
    assert body["share_url"].endswith(f"/p/{body['share_token']}")
    assert body["verify_url"].endswith(f"/v/{body['pack']['id']}")


async def test_list_packs_never_returns_token(client, audit_trip, pdf_store):
    # Arrange
    issued = await _issue_via_api(client, audit_trip)

    # Act
    response = await client.get(PACKS.format(trip_id=audit_trip.trip.id), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert [p["id"] for p in response.json()] == [issued["pack"]["id"]]
    assert issued["share_token"] not in response.text


async def test_issue_pack_rejects_unknown_purpose(client, audit_trip, pdf_store):
    # Act
    response = await client.post(PACKS.format(trip_id=audit_trip.trip.id),
                                 json={**ISSUE_BODY, "purpose": "marketing"}, headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 422


async def test_issue_pack_rejects_unoffered_expiry(client, audit_trip, pdf_store):
    # Act
    response = await client.post(PACKS.format(trip_id=audit_trip.trip.id),
                                 json={**ISSUE_BODY, "expires_in_days": 365}, headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 422


async def test_issue_pack_unknown_trip_is_404(client, audit_trip, pdf_store):
    # Act
    response = await client.post(PACKS.format(trip_id=uuid.uuid4()), json=ISSUE_BODY, headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 404


async def test_issue_pack_rejects_non_admin(client, audit_trip, pdf_store):
    # Arrange
    token = make_token(sub=str(audit_trip.dispatcher.id), role="dispatcher", org_id=str(audit_trip.org.id))

    # Act
    response = await client.post(PACKS.format(trip_id=audit_trip.trip.id), json=ISSUE_BODY,
                                 headers=auth_header(token))

    # Assert
    assert response.status_code == 403


async def test_issue_pack_storage_outage_is_503_and_issues_nothing(client, audit_trip, monkeypatch, db_session):
    # Arrange
    async def broken_upload(**_kwargs: object) -> UploadResult:
        raise EvidenceStorageUnavailableError("down")

    monkeypatch.setattr(audit_pack_service, "upload_audit_pack_pdf", broken_upload)

    # Act
    response = await client.post(PACKS.format(trip_id=audit_trip.trip.id), json=ISSUE_BODY,
                                 headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 503
    assert (await db_session.execute(select(AuditPack))).scalars().all() == []


async def test_revoke_pack_marks_revoked(client, audit_trip, pdf_store, db_session):
    # Arrange
    issued = await _issue_via_api(client, audit_trip)

    # Act
    response = await client.post(f"{PACK.format(pack_id=issued['pack']['id'])}/revoke", headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert response.json()["status"] == "revoked"
    pack = (await db_session.execute(select(AuditPack))).scalar_one()
    assert pack.revoked_at is not None


async def test_revoke_pack_other_org_is_404(client, audit_trip, pdf_store, db_session):
    # Arrange: an admin of a different operator. Org scoping comes from the user's DB row,
    # never the token's org claim, so the outsider needs a real account elsewhere.
    issued = await _issue_via_api(client, audit_trip)
    other_org = Organization(id=uuid.uuid4(), name="Rival Haulage", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    outsider = User(id=uuid.uuid4(), organization_id=other_org.id, email="x@rival.co.za", full_name="X")
    db_session.add(outsider)
    await db_session.flush()
    headers = auth_header(make_token(sub=str(outsider.id), role="admin_dispatcher", org_id=str(other_org.id)))

    # Act
    response = await client.post(f"{PACK.format(pack_id=issued['pack']['id'])}/revoke", headers=headers)

    # Assert
    assert response.status_code == 404


async def test_download_issued_pdf_returns_stored_bytes(client, audit_trip, pdf_store):
    # Arrange
    issued = await _issue_via_api(client, audit_trip)

    # Act
    response = await client.get(f"{PACK.format(pack_id=issued['pack']['id'])}/pdf", headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert hashlib.sha256(response.content).hexdigest() == issued["pack"]["pdf_sha256"]


async def test_download_issued_pdf_refuses_altered_file(client, audit_trip, pdf_store):
    # Arrange: someone replaced the stored object after issue.
    issued = await _issue_via_api(client, audit_trip)
    key = next(iter(pdf_store))
    pdf_store[key] = pdf_store[key] + b"tampered"

    # Act
    response = await client.get(f"{PACK.format(pack_id=issued['pack']['id'])}/pdf", headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 409


async def test_access_events_start_empty(client, audit_trip, pdf_store):
    # Arrange
    issued = await _issue_via_api(client, audit_trip)

    # Act
    response = await client.get(f"{PACK.format(pack_id=issued['pack']['id'])}/access-events",
                                headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert response.json() == []


SHEET = "/api/v1/trips/{trip_id}/audit-trail/incident-sheet.pdf"


async def test_incident_sheet_pdf_for_trip_with_critical_incident(client, audit_trip):
    # Act
    response = await client.get(SHEET.format(trip_id=audit_trip.trip.id), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages)
    assert "Incident fact sheet" in text
    assert "ABC123GP" in text


async def test_incident_sheet_pdf_without_critical_incident_is_409(client, audit_trip, db_session):
    # Arrange
    audit_trip.panic.severity = "warning"
    await db_session.flush()

    # Act
    response = await client.get(SHEET.format(trip_id=audit_trip.trip.id), headers=_admin(audit_trip))

    # Assert
    assert response.status_code == 409


async def test_incident_sheet_pdf_rejects_non_admin(client, audit_trip):
    token = make_token(sub=str(audit_trip.dispatcher.id), role="dispatcher", org_id=str(audit_trip.org.id))
    response = await client.get(SHEET.format(trip_id=audit_trip.trip.id), headers=auth_header(token))
    assert response.status_code == 403
