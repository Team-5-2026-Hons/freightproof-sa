"""Integration tests for issuing, sealing, listing and revoking audit packs."""

import hashlib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.core.exceptions import HederaServiceError, ResourceNotFoundError
from app.db.models.audit_packs import AuditPack, AuditPackAccessEvent
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AuditPackAccessEventType
from app.orchestration import audit_pack_service
from app.orchestration.audit_pack_service import (
    issue_audit_pack,
    list_audit_packs,
    revoke_audit_pack,
    seal_payload,
)
from app.schemas.audit_pack import AuditPackCreate
from app.schemas.people import UserRead
from app.storage.supabase_storage import UploadResult

from tests.integration.audit_pack_seed import T0, AuditTrip, seed_audit_trip

NOW = T0 + timedelta(days=1)


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


@pytest.fixture
def stored_pdfs(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    store: dict[str, bytes] = {}

    async def fake_upload(*, trip_id: str, pack_id: str, pdf_bytes: bytes) -> UploadResult:
        key = f"audit-packs/{trip_id}/{pack_id}.pdf"
        store[key] = pdf_bytes
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=key, file_hash=hashlib.sha256(pdf_bytes).hexdigest())

    monkeypatch.setattr(audit_pack_service, "upload_audit_pack_pdf", fake_upload)
    return store


def _user(seed: AuditTrip) -> UserRead:
    return UserRead.model_validate(seed.dispatcher)


def _request(**overrides: object) -> AuditPackCreate:
    fields: dict[str, object] = dict(
        recipient_name="Jane Adjuster", recipient_organization="Santam Claims",
        recipient_email="jane@santam.example", purpose="insurance_claim", external_reference="CLM-88123",
    )
    fields.update(overrides)
    return AuditPackCreate.model_validate(fields)


async def _issue(db: AsyncSession, seed: AuditTrip, **overrides: object) -> audit_pack_service.IssuedPack:
    return await issue_audit_pack(
        db, trip_id=seed.trip.id, organization_id=seed.org.id, issued_by=_user(seed),
        request=_request(**overrides), now=NOW,
    )


async def test_issue_audit_pack_stores_sealed_first_version(db_session, audit_trip, stored_pdfs):
    # Act
    issued = await _issue(db_session, audit_trip)

    # Assert
    pack = issued.pack
    assert pack.pack_version == 1
    assert pack.issued_at == NOW
    assert pack.expires_at == NOW + timedelta(days=30)
    assert pack.anchor_status == "anchored"
    stored = stored_pdfs[pack.pdf_storage_key]
    assert stored.startswith(b"%PDF-")
    assert pack.pdf_sha256 == hashlib.sha256(stored).hexdigest()
    assert pack.pdf_size_bytes == len(stored)


async def test_issue_audit_pack_stores_only_token_hash(db_session, audit_trip, stored_pdfs):
    # Act
    issued = await _issue(db_session, audit_trip)

    # Assert
    assert len(issued.raw_token) >= 40
    assert issued.pack.token_hash == hashlib.sha256(issued.raw_token.encode()).hexdigest()
    assert issued.raw_token not in str(issued.pack.manifest_json)


async def test_issue_audit_pack_manifest_hash_survives_reload(db_session, audit_trip, stored_pdfs):
    # Arrange
    pack_id = (await _issue(db_session, audit_trip)).pack.id
    await db_session.flush()
    db_session.expire_all()

    # Act
    reloaded = (await db_session.execute(select(AuditPack).where(AuditPack.id == pack_id))).scalar_one()

    # Assert
    assert compute_payload_hash(reloaded.manifest_json) == reloaded.manifest_sha256


async def test_issue_audit_pack_seal_receipt_matches_reconstructed_payload(db_session, audit_trip, stored_pdfs):
    # Arrange
    pack_id = (await _issue(db_session, audit_trip)).pack.id
    await db_session.flush()
    db_session.expire_all()
    pack = (await db_session.execute(select(AuditPack).where(AuditPack.id == pack_id))).scalar_one()

    # Act
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == pack.blockchain_receipt_id)
    )).scalar_one()

    # Assert
    assert receipt.subject_type == "audit_pack"
    assert receipt.receipt_type == "audit_pack_issued"
    assert receipt.data_hash == compute_payload_hash(seal_payload(pack))
    assert set(receipt.payload_json) == {
        "payload_version", "pack_id", "trip_id", "pack_version", "manifest_sha256", "pdf_sha256", "issued_at",
    }


async def test_issue_audit_pack_second_issue_is_next_version(db_session, audit_trip, stored_pdfs):
    # Act
    await _issue(db_session, audit_trip)
    second = await _issue(db_session, audit_trip, purpose="police_report")

    # Assert
    assert second.pack.pack_version == 2


async def test_issue_audit_pack_anchor_failure_still_issues(db_session, audit_trip, stored_pdfs, monkeypatch):
    # Arrange
    async def failing_anchor(*_args: object, **_kwargs: object) -> BlockchainReceipt:
        raise HederaServiceError("mirror down")

    monkeypatch.setattr(audit_pack_service, "anchor_subject", failing_anchor)

    # Act
    issued = await _issue(db_session, audit_trip)

    # Assert
    assert issued.pack.anchor_status == "failed"
    assert issued.pack.blockchain_receipt_id is None


async def test_issue_audit_pack_records_scope_and_choices(db_session, audit_trip, stored_pdfs):
    # Act
    issued = await _issue(
        db_session, audit_trip, scope_consignment_id=str(audit_trip.consignment_a.id),
        include_location_trail=False, include_full_driver_id=True, expires_in_days=7,
    )

    # Assert
    pack = issued.pack
    assert pack.consignment_id == audit_trip.consignment_a.id
    assert pack.include_location_trail is False
    assert pack.include_full_driver_id is True
    assert pack.expires_at == NOW + timedelta(days=7)
    assert pack.manifest_json["options"]["scope_consignment_id"] == str(audit_trip.consignment_a.id)


async def test_issue_audit_pack_other_org_trip_raises(db_session, audit_trip, stored_pdfs):
    # Act / Assert
    with pytest.raises(ResourceNotFoundError):
        await issue_audit_pack(
            db_session, trip_id=audit_trip.trip.id, organization_id=uuid.uuid4(),
            issued_by=_user(audit_trip), request=_request(), now=NOW,
        )


async def test_revoke_audit_pack_is_idempotent(db_session, audit_trip, stored_pdfs):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    first_at = NOW + timedelta(hours=1)

    # Act
    await revoke_audit_pack(db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id,
                            user_id=audit_trip.dispatcher.id, now=first_at)
    again = await revoke_audit_pack(db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id,
                                    user_id=audit_trip.dispatcher.id, now=first_at + timedelta(hours=1))

    # Assert
    assert again.revoked_at == first_at
    assert again.revoked_by_user_id == audit_trip.dispatcher.id


async def test_revoke_audit_pack_other_org_raises(db_session, audit_trip, stored_pdfs):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act / Assert
    with pytest.raises(ResourceNotFoundError):
        await revoke_audit_pack(db_session, pack_id=issued.pack.id, organization_id=uuid.uuid4(),
                                user_id=audit_trip.dispatcher.id)


async def test_list_audit_packs_reports_status_label_and_views(db_session, audit_trip, stored_pdfs):
    # Arrange
    first = await _issue(db_session, audit_trip)
    await _issue(db_session, audit_trip, expires_in_days=7)
    await revoke_audit_pack(db_session, pack_id=first.pack.id, organization_id=audit_trip.org.id,
                            user_id=audit_trip.dispatcher.id, now=NOW)
    db_session.add_all([
        AuditPackAccessEvent(id=uuid.uuid4(), audit_pack_id=first.pack.id,
                             event_type=AuditPackAccessEventType.VIEWED, created_at=NOW),
        AuditPackAccessEvent(id=uuid.uuid4(), audit_pack_id=first.pack.id,
                             event_type=AuditPackAccessEventType.VIEWED, created_at=NOW + timedelta(minutes=5)),
    ])
    await db_session.flush()

    # Act
    packs = await list_audit_packs(db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id,
                                   now=NOW + timedelta(days=8))

    # Assert
    by_version = {p.pack_label: p for p in packs}
    assert set(by_version) == {"FP-AUDIT-AP1", "FP-AUDIT-AP2"}
    assert by_version["FP-AUDIT-AP1"].status == "revoked"
    assert by_version["FP-AUDIT-AP1"].view_count == 2
    assert by_version["FP-AUDIT-AP1"].last_viewed_at == NOW + timedelta(minutes=5)
    assert by_version["FP-AUDIT-AP2"].status == "expired"
    assert by_version["FP-AUDIT-AP2"].hedera_sequence_number is not None
    assert by_version["FP-AUDIT-AP2"].anchor_status == "anchored"


async def test_list_audit_packs_other_org_sees_nothing(db_session, audit_trip, stored_pdfs):
    # Arrange
    await _issue(db_session, audit_trip)

    # Act
    packs = await list_audit_packs(db_session, trip_id=audit_trip.trip.id, organization_id=uuid.uuid4())

    # Assert
    assert packs == []
