"""Public, zero-login audit-pack routes: the share link an insurer opens, and the seal
check printed in every PDF. No auth header is ever sent in this file."""

import hashlib
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_packs import AuditPackAccessEvent
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.transit import TripException
from app.db.session import get_db
from app.main import app
from app.orchestration import audit_pack_access, audit_pack_service
from app.orchestration.audit_pack_service import IssuedPack, issue_audit_pack, revoke_audit_pack
from app.schemas.audit_pack import AuditPackCreate
from app.schemas.people import UserRead
from app.storage.supabase_storage import UploadResult

from tests.integration.audit_pack_seed import AuditTrip, seed_audit_trip

PUBLIC = "/api/v1/public/audit-packs"


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


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch, audit_trip: AuditTrip) -> dict[str, bytes]:
    """Fake Storage for both pack PDFs and evidence photos; photos hash to the seed's
    recorded file_hash, so live verification sees untouched evidence."""
    store: dict[str, bytes] = {}

    async def fake_upload(*, trip_id: str, pack_id: str, pdf_bytes: bytes) -> UploadResult:
        key = f"audit-packs/{trip_id}/{pack_id}.pdf"
        store[key] = pdf_bytes
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=key, file_hash=hashlib.sha256(pdf_bytes).hexdigest())

    async def fake_download(*, s3_bucket: str, s3_key: str) -> bytes:
        return store[s3_key]

    for label in ("seal", "waybill", "pod", "signature", "selfie"):
        store[f"{label}.jpg"] = label.encode()

    async def fake_hash(*, s3_bucket: str, s3_key: str) -> str:
        return hashlib.sha256(store[s3_key]).hexdigest()

    monkeypatch.setattr(audit_pack_service, "upload_audit_pack_pdf", fake_upload)
    monkeypatch.setattr(audit_pack_access, "download_audit_pack_pdf", fake_download)
    monkeypatch.setattr(audit_pack_access, "download_evidence_file", fake_download)
    monkeypatch.setattr("app.orchestration.verification_service.hash_stored_evidence_file", fake_hash)
    return store


async def _issue(db: AsyncSession, seed: AuditTrip, **overrides: object) -> IssuedPack:
    request = AuditPackCreate.model_validate({
        "recipient_name": "Jane Adjuster", "recipient_organization": "Santam Claims",
        "purpose": "insurance_claim", **overrides,
    })
    return await issue_audit_pack(
        db, trip_id=seed.trip.id, organization_id=seed.org.id,
        issued_by=UserRead.model_validate(seed.dispatcher), request=request,
    )


async def _events(db: AsyncSession) -> list[str]:
    rows = (await db.execute(select(AuditPackAccessEvent.event_type))).scalars().all()
    return [str(getattr(r, "value", r)) for r in rows]


async def test_open_shared_pack_returns_manifest_seal_and_logs_view(client: AsyncClient, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={"User-Agent": "ClaimsBrowser/1.0"})

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["manifest"]["trip"]["trip_reference"] == "FP-AUDIT"
    assert body["recipient_organization"] == "Santam Claims"
    assert body["seal"]["pack_label"] == "FP-AUDIT-AP1"
    assert body["seal"]["seal"]["data_hash"]
    assert body["seal"]["mirror_base_url"].startswith("https://")
    event = (await db_session.execute(select(AuditPackAccessEvent))).scalar_one()
    assert str(getattr(event.event_type, "value", event.event_type)) == "viewed"
    assert event.user_agent == "ClaimsBrowser/1.0"


async def test_open_shared_pack_unknown_token_is_404_and_logs_nothing(client, db_session, audit_trip, storage):
    # Act
    response = await client.get(f"{PUBLIC}/not-a-real-token-at-all")

    # Assert
    assert response.status_code == 404
    assert await _events(db_session) == []


async def test_open_shared_pack_revoked_is_410_and_logged(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await revoke_audit_pack(db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id,
                            user_id=audit_trip.dispatcher.id)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 410
    assert "revoked" in response.json()["detail"]
    assert await _events(db_session) == ["denied_revoked"]


async def test_open_shared_pack_expired_is_410_and_logged(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    issued.pack.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 410
    assert "expired" in response.json()["detail"]
    assert await _events(db_session) == ["denied_expired"]


async def test_shared_pdf_download_is_logged(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}/pdf")

    # Assert
    assert response.status_code == 200
    assert hashlib.sha256(response.content).hexdigest() == issued.pack.pdf_sha256
    assert await _events(db_session) == ["pdf_downloaded"]


async def test_shared_artifact_in_manifest_is_served(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}/artifacts/{audit_trip.seal_photo.id}")

    # Assert
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert hashlib.sha256(response.content).hexdigest() == audit_trip.seal_photo.file_hash
    assert await _events(db_session) == ["photo_viewed"]


async def test_shared_artifact_not_in_manifest_is_404(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}/artifacts/{uuid.uuid4()}")

    # Assert
    assert response.status_code == 404


async def test_pack_seal_check_by_id_shows_no_evidence(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/seal/{issued.pack.id}")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["pdf_sha256"] == issued.pack.pdf_sha256
    assert body["pack_label"] == "FP-AUDIT-AP1"
    assert "manifest" not in body
    assert "Santam" not in response.text


async def test_pack_seal_check_unknown_id_is_404(client, db_session, audit_trip, storage):
    # Act
    response = await client.get(f"{PUBLIC}/seal/{uuid.uuid4()}")

    # Assert
    assert response.status_code == 404


async def test_live_verification_reports_verified_records_and_seal(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    with patch("app.orchestration.audit_pack_access.HederaService") as mirror:
        mirror.return_value.verify_hash.return_value = True
        response = await client.post(f"{PUBLIC}/{issued.raw_token}/verify")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["seal_status"] == "verified"
    assert {r["status"] for r in body["records"]} == {"verified"}
    assert body["records_added_since_issue"] == 0
    assert await _events(db_session) == ["verify_run"]


async def test_live_verification_detects_record_changed_after_issue(client, db_session, audit_trip, storage):
    # Arrange: the snapshot is frozen, but someone edits the live seal number afterwards.
    issued = await _issue(db_session, audit_trip)
    audit_trip.departure.seal_number = "SEAL-FORGED"
    await db_session.flush()

    # Act
    with patch("app.orchestration.audit_pack_access.HederaService") as mirror:
        mirror.return_value.verify_hash.return_value = True
        response = await client.post(f"{PUBLIC}/{issued.raw_token}/verify")

    # Assert
    statuses = {r["subject_id"]: r["status"] for r in response.json()["records"]}
    assert statuses[str(audit_trip.departure.id)] == "db_mismatch"


async def test_live_verification_counts_records_added_after_issue(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    db_session.add(TripException(
        id=uuid.uuid4(), trip_id=audit_trip.trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.INFO, description="late note",
        created_at=issued.pack.issued_at + timedelta(minutes=5),
    ))
    await db_session.flush()

    # Act
    with patch("app.orchestration.audit_pack_access.HederaService") as mirror:
        mirror.return_value.verify_hash.return_value = True
        response = await client.post(f"{PUBLIC}/{issued.raw_token}/verify")

    # Assert
    assert response.json()["records_added_since_issue"] == 1


async def test_live_verification_mirror_down_is_error_not_mismatch(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    with patch("app.orchestration.audit_pack_access.HederaService") as mirror:
        from app.blockchain.hedera import HederaVerifyError
        mirror.return_value.verify_hash.side_effect = HederaVerifyError("mirror down")
        response = await client.post(f"{PUBLIC}/{issued.raw_token}/verify")

    # Assert
    assert response.json()["seal_status"] == "error"


async def test_shared_incident_sheet_is_rendered_from_the_frozen_pack(client, db_session, audit_trip, storage):
    # Arrange: issue, then change the live trip — the sheet must still show the snapshot.
    issued = await _issue(db_session, audit_trip)
    audit_trip.panic.severity = "warning"
    await db_session.flush()

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}/incident-sheet.pdf")

    # Assert
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")
    assert await _events(db_session) == ["pdf_downloaded"]
