"""Integration tests for incident documents behind INCIDENT_DOCUMENTS_ENABLED:

  POST /incidents/{id}/documents
  GET  /incidents/{id}/documents/{artifact_id}/url

Storage is faked at the orchestration module's import site, as the artifact-upload tests do.
"""

import hashlib
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.trips import Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.orchestration.evidence.artifacts import MAX_FILE_SIZE_BYTES
from app.storage.supabase_storage import UploadResult

from tests.conftest import auth_header, make_token

# The smallest byte string the MIME sniffer accepts as a PDF.
_PDF_BYTES = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def stored(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    """Fake Storage: records every upload instead of calling Supabase."""
    uploads: list[bytes] = []

    async def fake_upload(*, trip_id: str, file_bytes: bytes, mime_type: str) -> UploadResult:
        uploads.append(file_bytes)
        return UploadResult(s3_bucket="evidence", s3_key=f"{trip_id}/{uuid.uuid4()}", file_hash=hashlib.sha256(file_bytes).hexdigest())

    async def fake_sign(**_kwargs: object) -> str:
        return "https://storage.test/signed"

    monkeypatch.setattr("app.orchestration.incidents.documents.upload_evidence_file", fake_upload)
    monkeypatch.setattr("app.orchestration.evidence.artifacts.create_signed_url", fake_sign)
    return uploads


@pytest.fixture
def enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.orchestration.incidents.documents.settings.INCIDENT_DOCUMENTS_ENABLED", True)


def _token(seed) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed["dispatcher"].id), role="dispatcher"))


async def _incident(client, db_session, seed) -> str:
    suffix = uuid.uuid4().hex[:8]
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-DOC-{suffix}", order_number=f"DOC-{suffix}",
        operator_organization_id=seed["org"].id, client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id, horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id, destination_precinct_id=seed["dest"].id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, planned_departure_at=datetime.now(UTC),
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()
    db_session.add(TripStop(trip_id=trip.id, precinct_id=seed["origin"].id, sequence=0))
    await db_session.flush()
    resp = await client.post(f"/api/v1/trips/{trip.id}/incidents", json={
        "incident_type": "hijacking", "summary": "Reported by tracking company", "reporter_role": "tracking_company",
        "report_channel": "phone", "confidence": "reported",
    }, headers=_token(seed))
    return resp.json()["incident_id"]


async def _attach(client, seed, incident_id: str, *, content: bytes = _PDF_BYTES, note: str = "SAPS case slip"):
    return await client.post(
        f"/api/v1/incidents/{incident_id}/documents",
        files={"file": ("case-slip.pdf", content, "application/pdf")}, data={"note": note}, headers=_token(seed),
    )


async def test_attach_document_disabled_returns_503(client, db_session, seed, stored):
    incident_id = await _incident(client, db_session, seed)

    resp = await _attach(client, seed, incident_id)

    assert resp.status_code == 503
    assert stored == []


async def test_attach_document_enabled_returns_201_and_hash(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)

    resp = await _attach(client, seed, incident_id)

    assert resp.status_code == 201
    entry = resp.json()["updates"][-1]
    assert entry["kind"] == "document_attached" and entry["to_value"] == "case-slip.pdf" and entry["note"] == "SAPS case slip"
    artifact = (await db_session.execute(
        select(EvidenceArtifact).where(EvidenceArtifact.id == uuid.UUID(entry["artifact_id"]))
    )).scalar_one()
    assert artifact.file_hash == hashlib.sha256(_PDF_BYTES).hexdigest()
    assert artifact.captured_by_user_id == seed["dispatcher"].id and artifact.captured_by_driver_id is None
    assert stored == [_PDF_BYTES]


async def test_attach_document_without_token_403(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)

    resp = await client.post(
        f"/api/v1/incidents/{incident_id}/documents",
        files={"file": ("x.pdf", _PDF_BYTES, "application/pdf")}, data={"note": "x"},
    )

    assert resp.status_code == 403


async def test_attach_document_404_other_org(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)
    org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other = User(id=uuid.uuid4(), organization_id=org.id, email=f"d-{uuid.uuid4().hex[:6]}@t.co.za", full_name="O")
    db_session.add(other)
    await db_session.flush()

    resp = await client.post(
        f"/api/v1/incidents/{incident_id}/documents",
        files={"file": ("x.pdf", _PDF_BYTES, "application/pdf")}, data={"note": "x"},
        headers=auth_header(make_token(sub=str(other.id), role="dispatcher")),
    )

    assert resp.status_code == 404
    assert stored == []


async def test_attach_document_closed_incident_409(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)
    await client.post(
        f"/api/v1/incidents/{incident_id}/close", json={"outcome": "inconclusive", "reason": "No leads"},
        headers=_token(seed),
    )

    resp = await _attach(client, seed, incident_id)

    assert resp.status_code == 409
    assert stored == []


async def test_attach_document_not_allowed_type_422(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)

    resp = await client.post(
        f"/api/v1/incidents/{incident_id}/documents",
        files={"file": ("notes.txt", b"just some text", "text/plain")}, data={"note": "x"}, headers=_token(seed),
    )

    assert resp.status_code == 422
    assert stored == []


async def test_attach_document_oversize_413(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)

    resp = await _attach(client, seed, incident_id, content=_PDF_BYTES + b"0" * MAX_FILE_SIZE_BYTES)

    assert resp.status_code == 413
    assert stored == []


async def test_attach_document_blank_note_422(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)

    resp = await _attach(client, seed, incident_id, note="   ")

    assert resp.status_code == 422


async def test_document_url_signs_cited_document_and_404s_others(client, db_session, seed, stored, enabled):
    incident_id = await _incident(client, db_session, seed)
    artifact_id = (await _attach(client, seed, incident_id)).json()["updates"][-1]["artifact_id"]

    cited = await client.get(f"/api/v1/incidents/{incident_id}/documents/{artifact_id}/url", headers=_token(seed))
    unknown = await client.get(f"/api/v1/incidents/{incident_id}/documents/{uuid.uuid4()}/url", headers=_token(seed))

    assert cited.status_code == 200 and cited.json()["signed_url"] == "https://storage.test/signed"
    assert unknown.status_code == 404


async def test_document_url_still_works_with_flag_off(client, db_session, seed, stored, enabled, monkeypatch):
    incident_id = await _incident(client, db_session, seed)
    artifact_id = (await _attach(client, seed, incident_id)).json()["updates"][-1]["artifact_id"]
    monkeypatch.setattr("app.orchestration.incidents.documents.settings.INCIDENT_DOCUMENTS_ENABLED", False)

    resp = await client.get(f"/api/v1/incidents/{incident_id}/documents/{artifact_id}/url", headers=_token(seed))

    assert resp.status_code == 200
