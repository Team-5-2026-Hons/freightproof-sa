"""FP-83 C5: freezing, anchoring, recovery, verification and the custody-chain integrity read.

Hedera is a fake (submit returns a receipt, or raises); Storage hashing is patched where a
receipt is verified. Everything runs on the rolled-back `db_session`; the dispatch-after-commit
boundary itself is the shared run_after_outer_commit, covered by the evidence-anchor tests.
"""

import itertools
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.blockchain.hedera import HederaReceipt
from app.blockchain.hedera import HederaSubmitError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.driver_substitutions import DriverSubstitutionCorrection, DriverSubstitutionRequest
from app.db.models.enums import AnchorStatus, DispatcherRole, SubjectType, TripType, VerifyStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions import anchors
from app.orchestration.substitutions.access import get_current_custody
from app.orchestration.substitutions.anchors import CustodyAnchorKind, anchor_custody_record, verify_custody_chain
from app.orchestration.substitutions.service import correct_completed_substitution
from app.orchestration.verification.service import verify_subject
from app.schemas.driver_substitutions import CorrectSubstitutionRequest, CustodyIntegrityStatus
from app.schemas.people import UserRead
from app.storage.supabase_storage import EvidenceStorageUnavailableError
from app.tasks.driver_substitutions import anchor_record_task
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, _photo, _seal, armed, both_confirmed, clock, confirm, get_row,
)

_SEQUENCE = itertools.count(1)


class FakeHedera:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.submitted: list[str] = []

    def submit_hash(self, hash_hex: str) -> HederaReceipt:
        if self.fail:
            raise HederaSubmitError("HCS down")
        self.submitted.append(hash_hex)
        return HederaReceipt(topic_id="0.0.1", sequence_number=next(_SEQUENCE), consensus_timestamp=None, transaction_id="tx")

    def verify_hash(self, topic_id: str, sequence_number: int, expected_hash_hex: str) -> bool:
        return expected_hash_hex in self.submitted


@pytest.fixture
def hedera(monkeypatch: pytest.MonkeyPatch) -> FakeHedera:
    fake = FakeHedera()
    monkeypatch.setattr("app.blockchain.anchor_service.HederaService", lambda: fake)
    return fake


async def completed(db: AsyncSession) -> tuple[uuid.UUID, DriverSubstitution]:
    w, pending = await armed(db)
    await both_confirmed(db, w, pending)
    row = (await db.execute(select(DriverSubstitution).where(DriverSubstitution.trip_id == w.trip_id))).scalar_one()
    return w.trip_id, row


async def test_completion_freezes_a_pending_commitment_and_queues_nothing_before_commit(db_session: AsyncSession):
    anchor_record_task.delay.reset_mock()  # type: ignore[attr-defined]

    _, row = await completed(db_session)

    assert (row.payload_version, row.anchor_status, row.blockchain_receipt_id) == (1, AnchorStatus.PENDING.value, None)
    assert row.event_hash == compute_payload_hash(row.payload_json)
    assert row.payload_json["sequence_number"] == 1 and row.payload_json["previous_event_hash"] is None
    assert set(row.payload_json["captures"]) == {"outgoing", "incoming"}
    # The test transaction never commits, so the after-commit dispatch never fires.
    anchor_record_task.delay.assert_not_called()  # type: ignore[attr-defined]


async def test_anchoring_links_one_receipt_and_a_second_worker_adds_none(db_session: AsyncSession, hedera: FakeHedera):
    _, row = await completed(db_session)

    assert await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)
    assert await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)

    receipts = (await db_session.execute(select(BlockchainReceipt).where(BlockchainReceipt.subject_id == row.id))).scalars().all()
    assert len(receipts) == 1 and len(hedera.submitted) == 1
    assert (receipts[0].subject_type, receipts[0].receipt_type, receipts[0].data_hash) == (
        SubjectType.DRIVER_SUBSTITUTION.value, "driver_substitution", row.event_hash,
    )
    assert (row.anchor_status, row.blockchain_receipt_id) == (AnchorStatus.ANCHORED.value, receipts[0].id)


async def test_a_hedera_outage_leaves_failed_debt_without_reversing_custody(db_session: AsyncSession, hedera: FakeHedera):
    trip_id, row = await completed(db_session)
    hedera.fail = True

    assert not await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)

    assert row.anchor_status == AnchorStatus.FAILED.value
    custody = await get_current_custody(db_session, trip=await get_row(db_session, Trip, trip_id))
    assert custody.substitution_id == row.id
    # The sweep picks the debt up once Hedera is back.
    hedera.fail = False
    row.updated_at = NOW - timedelta(hours=1)
    await db_session.flush()
    assert await anchors.recover_custody_anchor(db_session, due_before=NOW) is True
    assert row.anchor_status == AnchorStatus.ANCHORED.value


async def test_edited_source_rows_are_refused_and_never_rebaselined(db_session: AsyncSession, hedera: FakeHedera):
    _, row = await completed(db_session)
    request = await get_row(db_session, DriverSubstitutionRequest, row.request_id)
    frozen = row.event_hash
    request.reason = "A different story"
    await db_session.flush()

    assert not await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)

    assert (row.anchor_status, row.event_hash, hedera.submitted) == (AnchorStatus.FAILED.value, frozen, [])


def org_dispatcher(trip: Trip) -> UserRead:
    return UserRead(
        id=trip.created_by_user_id, organization_id=trip.operator_organization_id, email="d@test.co.za",
        full_name="Dispatcher", created_at=NOW, updated_at=NOW, role=DispatcherRole.DISPATCHER,
    )


async def test_a_correction_is_independently_anchored(db_session: AsyncSession, hedera: FakeHedera):
    trip_id, row = await completed(db_session)
    read = await correct_completed_substitution(
        db_session, trip_id=trip_id, substitution_id=row.id, actor=org_dispatcher(await get_row(db_session, Trip, trip_id)),
        payload=CorrectSubstitutionRequest(client_request_id=uuid.uuid4(), reason="Depot name", correction_note="Gate 3"),
    )

    assert await anchor_custody_record(db_session, kind=CustodyAnchorKind.CORRECTION, record_id=read.id)

    correction = await get_row(db_session, DriverSubstitutionCorrection, read.id)
    assert correction.receipt_id is not None
    receipt = await get_row(db_session, BlockchainReceipt, correction.receipt_id)
    assert (receipt.subject_type, receipt.receipt_type) == ("driver_substitution_correction", "driver_substitution_corrected")
    assert (correction.anchor_status, row.blockchain_receipt_id) == (AnchorStatus.ANCHORED.value, None)
    verified = await verify_subject(
        db_session, subject_type=SubjectType.DRIVER_SUBSTITUTION_CORRECTION, subject_id=read.id,
        hedera_service=hedera,  # type: ignore[arg-type]
    )
    assert verified.status is VerifyStatus.VERIFIED


# ── verification ─────────────────────────────────────────────────────────────


async def test_an_anchored_handover_verifies_and_an_edited_row_does_not(
    db_session: AsyncSession, hedera: FakeHedera, monkeypatch: pytest.MonkeyPatch,
):
    _, row = await completed(db_session)
    await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)

    ok = await verify_subject(db_session, subject_type=SubjectType.DRIVER_SUBSTITUTION, subject_id=row.id, hedera_service=hedera)  # type: ignore[arg-type]
    row.completion_mode = "dispatcher_attested"
    await db_session.flush()
    edited = await verify_subject(db_session, subject_type=SubjectType.DRIVER_SUBSTITUTION, subject_id=row.id, hedera_service=hedera)  # type: ignore[arg-type]

    assert ok.status is VerifyStatus.VERIFIED
    assert edited.status is VerifyStatus.DB_MISMATCH


# ── custody-chain integrity ──────────────────────────────────────────────────


async def test_chain_integrity_is_pending_then_verified(db_session: AsyncSession, hedera: FakeHedera):
    trip_id, row = await completed(db_session)
    org_id = (await get_row(db_session, Trip, trip_id)).operator_organization_id

    before = await verify_custody_chain(db_session, trip_id=trip_id, organization_id=org_id)
    await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)
    after = await verify_custody_chain(db_session, trip_id=trip_id, organization_id=org_id)

    assert (before.status, before.amendment_count, before.pending_anchor_count) == (CustodyIntegrityStatus.PENDING, 1, 1)
    assert (after.status, after.pending_anchor_count, after.findings) == (CustodyIntegrityStatus.VERIFIED, 0, [])


async def test_deleting_the_newest_amendment_is_a_finding(db_session: AsyncSession, hedera: FakeHedera):
    trip_id, row = await completed(db_session)
    org_id = (await get_row(db_session, Trip, trip_id)).operator_organization_id
    await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)
    receipt_id = row.blockchain_receipt_id
    row.blockchain_receipt_id = None
    await db_session.flush()
    await db_session.execute(delete(DriverSubstitution).where(DriverSubstitution.id == row.id))

    result = await verify_custody_chain(db_session, trip_id=trip_id, organization_id=org_id)

    assert result.status is CustodyIntegrityStatus.FAILED and result.amendment_count == 0
    assert any("has no custody amendment" in finding for finding in result.findings)
    assert any("missing from the chain" in finding for finding in result.findings)
    assert receipt_id is not None


async def test_a_tampered_amendment_is_a_finding(db_session: AsyncSession):
    trip_id, row = await completed(db_session)
    org_id = (await get_row(db_session, Trip, trip_id)).operator_organization_id
    row.missing_confirmation_reason = "inserted later"
    await db_session.flush()

    result = await verify_custody_chain(db_session, trip_id=trip_id, organization_id=org_id)

    assert result.status is CustodyIntegrityStatus.FAILED
    assert result.findings == ["Amendment 1 no longer matches its commitment."]


async def test_a_photo_whose_stored_bytes_changed_fails_verification(
    db_session: AsyncSession, hedera: FakeHedera, monkeypatch: pytest.MonkeyPatch,
):
    w, pending = await armed(db_session)
    (await get_row(db_session, Trip, w.trip_id)).trip_type = TripType.LOADED.value
    out_photo = await _photo(db_session, w, driver_id=w.a, request_id=pending.id)
    in_photo = await _photo(db_session, w, driver_id=w.b, request_id=pending.id)
    first = await confirm(db_session, w, pending, w.a, seal_checks=_seal(w, out_photo))
    await confirm(db_session, w, first, w.b, seal_checks=_seal(w, in_photo))
    row = (await db_session.execute(select(DriverSubstitution).where(DriverSubstitution.trip_id == w.trip_id))).scalar_one()
    await anchor_custody_record(db_session, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)
    recorded = {a.s3_key: a.file_hash for a in (await db_session.execute(select(EvidenceArtifact))).scalars()}
    state = {"tamper": False, "down": False}

    async def stored_hash(*, s3_bucket: str, s3_key: str) -> str:
        if state["down"]:
            raise EvidenceStorageUnavailableError("storage down")
        return "0" * 64 if state["tamper"] else recorded[s3_key]

    monkeypatch.setattr("app.orchestration.verification.service.hash_stored_evidence_file", stored_hash)

    async def verify():
        return (await verify_subject(
            db_session, subject_type=SubjectType.DRIVER_SUBSTITUTION, subject_id=row.id,
            hedera_service=hedera,  # type: ignore[arg-type]
        )).status

    assert await verify() is VerifyStatus.VERIFIED
    state["tamper"] = True
    assert await verify() is VerifyStatus.DB_MISMATCH
    state["down"] = True
    assert await verify() is VerifyStatus.ERROR
