"""FP-290 Task 5: the audit pack carries every exception photo and each action's anchor.

Manifest v2 adds photo collections and per-action anchor summaries to an exception. These
tests pin the tier rules (only a matching, anchored event promotes anything; a review receipt
never promotes the raise tier; GPS stays recorded), consignment scoping of events, receipts
and photos, exact-receipt live checks, and that a v1 manifest still reads.
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, ExceptionReviewOutcome, ExceptionReviewStatus, ExceptionSeverity,
    ExceptionSource, ExceptionType, SubjectType, TripStatus, VerifyStatus,
)
from app.db.models.transit import TripException
from app.orchestration.audit_packs.builder import build_audit_manifest
from app.orchestration.evidence_anchors.recording import prepare_exception_anchors, prepare_review_anchor
from app.orchestration.verification.service import verify_subject
from app.schemas.audit_pack import AuditPackManifest, AuditPackOptions

from tests.integration._audit_pack_anchor_helpers import anchor_event as _anchor
from tests.integration._audit_pack_anchor_helpers import raise_critical as _raise
from tests.integration._audit_pack_anchor_helpers import review_exception as _review
from tests.integration.audit_pack_seed import T0, AuditTrip, seed_audit_trip

pytestmark = pytest.mark.usefixtures("fake_pdf_renderer")

_GENERATED = T0 + timedelta(days=1)


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


@pytest.fixture(autouse=True)
def stored_photo_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Storage holds each seeded photo under `<label>.jpg`, hashing to the artifact's file_hash."""
    async def fake_hash(*, s3_bucket: str, s3_key: str) -> str:
        return hashlib.sha256(s3_key.removesuffix(".jpg").encode()).hexdigest()

    monkeypatch.setattr("app.orchestration.verification.evidence_payloads.hash_stored_evidence_file", fake_hash)


async def _build(db: AsyncSession, seed: AuditTrip, **options: object) -> AuditPackManifest:
    return await _build_for(db, seed, AuditPackOptions(**options))


async def _build_for(db: AsyncSession, seed: AuditTrip, options: AuditPackOptions) -> AuditPackManifest:
    return await build_audit_manifest(
        db, trip_id=seed.trip.id, operator_organization_id=seed.org.id, options=options, generated_at=_GENERATED,
    )


def _record(manifest: AuditPackManifest, exception: TripException):
    return next(e for e in manifest.exceptions if e.exception_id == exception.id)


async def test_new_manifest_is_version_4(db_session, audit_trip):
    manifest = await _build(db_session, audit_trip)

    assert manifest.manifest_version == 4


async def test_v3_manifest_without_investigations_still_validates(db_session, audit_trip):
    stored = (await _build(db_session, audit_trip)).as_json_dict()
    stored["manifest_version"] = 3
    del stored["investigations"]
    del stored["incident"]

    reread = AuditPackManifest.model_validate(stored)

    assert reread.manifest_version == 3 and reread.investigations == []


async def test_two_photo_critical_exception_is_anchored_with_every_photo_tied_to_its_receipt(
    db_session, audit_trip,
):
    exception, event = await _raise(db_session, audit_trip, photos=2)
    receipt = await _anchor(db_session, audit_trip, event)

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "anchored"
    assert [p.position for p in record.photos] == [0, 1]
    assert {p.tier for p in record.photos} == {"anchored"}
    assert {p.anchor_receipt_id for p in record.photos} == {receipt.id}
    assert {p.anchor_event_id for p in record.photos} == {event.id}
    [raised] = record.anchors
    assert (raised.action, raised.anchor_status, raised.receipt_id, raised.tier) == (
        "raised", "anchored", receipt.id, "anchored",
    )


async def test_every_photo_is_also_listed_as_evidence_for_readers_of_v1_fields(db_session, audit_trip):
    exception, _event = await _raise(db_session, audit_trip, photos=2)

    record = _record(await _build(db_session, audit_trip), exception)

    assert [e.artifact_id for e in record.evidence] == [p.artifact_id for p in record.photos]
    assert {e.role for e in record.evidence} == {"exception_supporting"}


async def test_pending_raise_event_leaves_the_exception_and_its_photos_recorded(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "recorded"
    assert {p.tier for p in record.photos} == {"recorded"}
    assert [(a.action, a.anchor_status, a.receipt_id) for a in record.anchors] == [("raised", "pending", None)]
    assert record.photos[0].anchor_receipt_id is None


async def test_review_receipt_never_promotes_the_raise_tier(db_session, audit_trip):
    exception, _raise_event = await _raise(db_session, audit_trip)
    review_event = await _review(db_session, audit_trip, exception)
    await _anchor(db_session, audit_trip, review_event)

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "recorded"
    assert {p.tier for p in record.photos} == {"recorded"}
    by_action = {a.action: a for a in record.anchors}
    assert by_action["raised"].tier == "recorded" and by_action["raised"].anchor_status == "pending"
    assert by_action["reviewed"].tier == "anchored"


async def test_review_of_a_historical_critical_exception_does_not_make_it_anchored(db_session, audit_trip):
    review_event = await prepare_review_anchor(db_session, exception=audit_trip.panic)
    await _anchor(db_session, audit_trip, review_event)

    record = _record(await _build(db_session, audit_trip), audit_trip.panic)

    assert record.tier == "recorded"
    assert [a.action for a in record.anchors] == ["reviewed"]


async def test_a_historical_exception_shows_no_anchor_summaries(db_session, audit_trip):
    record = _record(await _build(db_session, audit_trip), audit_trip.panic)

    assert record.anchors == []
    assert record.photos == []


async def test_editing_the_description_after_anchoring_drops_the_exception_to_recorded(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    await _anchor(db_session, audit_trip, event)
    exception.description = "Nothing happened."
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "recorded"
    assert record.anchors[0].tier == "recorded"
    assert {p.tier for p in record.photos} == {"anchored"}


async def test_a_photo_whose_hash_changed_after_anchoring_is_recorded_not_anchored(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip, photos=2)
    await _anchor(db_session, audit_trip, event)
    [tampered_id, intact_id] = [p["artifact_id"] for p in event.payload_json["photos"]]
    tampered = await db_session.get(type(audit_trip.seal_photo), uuid.UUID(tampered_id))
    tampered.file_hash = hashlib.sha256(b"swapped").hexdigest()
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    tiers = {str(p.artifact_id): p.tier for p in record.photos}
    assert tiers[tampered_id] == "recorded" and tiers[intact_id] == "anchored"
    assert record.tier == "recorded"


async def test_gps_stays_recorded_and_editing_it_does_not_break_the_anchor(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    await _anchor(db_session, audit_trip, event)
    exception.gps_lat = -26.0
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.position is not None and record.position_tier == "recorded"
    assert record.tier == "anchored"


async def test_scoped_pack_withholds_other_consignments_events_receipts_and_photos(db_session, audit_trip):
    mine, mine_event = await _raise(
        db_session, audit_trip, consignment_id=audit_trip.consignment_a.id, label="mine",
    )
    theirs, theirs_event = await _raise(
        db_session, audit_trip, consignment_id=audit_trip.consignment_b.id, label="theirs",
    )
    mine_receipt = await _anchor(db_session, audit_trip, mine_event)
    theirs_receipt = await _anchor(db_session, audit_trip, theirs_event)

    manifest = await _build(db_session, audit_trip, scope_consignment_id=audit_trip.consignment_a.id)

    assert {e.exception_id for e in manifest.exceptions} >= {mine.id}
    assert theirs.id not in {e.exception_id for e in manifest.exceptions}
    receipt_ids = {r.receipt_id for r in manifest.anchored_records}
    assert mine_receipt.id in receipt_ids and theirs_receipt.id not in receipt_ids
    their_photos = {uuid.UUID(p["artifact_id"]) for p in theirs_event.payload_json["photos"]}
    listed = {f.artifact_id for e in manifest.exceptions for f in (*e.evidence, *e.photos)}
    assert not (their_photos & listed)
    assert theirs_event.id not in {a.event_id for e in manifest.exceptions for a in e.anchors}


async def test_unscoped_pack_includes_every_consignments_events_and_receipts(db_session, audit_trip):
    theirs, theirs_event = await _raise(
        db_session, audit_trip, consignment_id=audit_trip.consignment_b.id, label="theirs",
    )
    theirs_receipt = await _anchor(db_session, audit_trip, theirs_event)

    manifest = await _build(db_session, audit_trip)

    assert theirs.id in {e.exception_id for e in manifest.exceptions}
    assert theirs_receipt.id in {r.receipt_id for r in manifest.anchored_records}


async def test_trip_level_cancellation_appears_in_every_scope(db_session, audit_trip):
    note = TripException(
        id=uuid.uuid4(), trip_id=audit_trip.trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        description=f"Cancelled by user {audit_trip.dispatcher.id}: vehicle hijacked",
        review_status=ExceptionReviewStatus.REVIEWED, review_outcome=ExceptionReviewOutcome.DISPATCHER_AUTHORED,
        reviewed_by_user_id=audit_trip.dispatcher.id, reviewed_at=audit_trip.trip.closed_at,
        created_at=audit_trip.trip.closed_at,
    )
    audit_trip.trip.status = TripStatus.CANCELLED
    db_session.add(note)
    await db_session.flush()
    events = await prepare_exception_anchors(db_session, exception=note, cancelled_trip=audit_trip.trip)
    cancelled = next(e for e in events if e.receipt_type == BlockchainReceiptType.TRIP_CANCELLED)
    receipt = await _anchor(db_session, audit_trip, cancelled)

    for scope in (None, audit_trip.consignment_a.id, audit_trip.consignment_b.id):
        manifest = await _build(db_session, audit_trip, scope_consignment_id=scope)
        record = _record(manifest, note)
        assert {(a.action, a.tier) for a in record.anchors} >= {("cancelled", "anchored")}
        assert receipt.id in {r.receipt_id for r in manifest.anchored_records}


async def test_v1_manifest_json_still_validates_and_reads_as_v1(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    await _anchor(db_session, audit_trip, event)
    document = (await _build(db_session, audit_trip)).as_json_dict()
    document["manifest_version"] = 1
    for record in document["exceptions"]:
        for key in ("photos", "anchors", "position_tier"):
            record.pop(key)

    manifest = AuditPackManifest.model_validate(document)

    assert manifest.manifest_version == 1
    assert all(e.photos == [] and e.anchors == [] for e in manifest.exceptions)
    assert all(e.tier == "anchored" for e in manifest.exceptions if e.exception_id == exception.id)


async def test_verify_subject_with_an_exact_receipt_id_checks_that_receipt_not_the_latest(
    db_session, audit_trip,
):
    _exception, event = await _raise(db_session, audit_trip)
    frozen = await _anchor(db_session, audit_trip, event)
    later = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=audit_trip.trip.id, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id,
        receipt_type=event.receipt_type, data_hash=compute_payload_hash({"other": 1}), hedera_topic_id="0.0.2002",
        hedera_sequence_number=901, hedera_tx_id="0.0.1@1.1", payload_json={"other": 1},
        created_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(later)
    await db_session.flush()
    hedera = patch("app.orchestration.verification.service.HederaService")

    with hedera as service:
        service.return_value.verify_hash.return_value = True
        latest_outcome = await verify_subject(
            db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id,
        )
        exact_outcome = await verify_subject(
            db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id, receipt_id=frozen.id,
        )

    assert latest_outcome.status != VerifyStatus.VERIFIED
    assert exact_outcome.status == VerifyStatus.VERIFIED
    assert exact_outcome.receipt is not None and exact_outcome.receipt.id == frozen.id


async def test_verify_subject_ignores_a_receipt_id_that_belongs_to_another_subject(db_session, audit_trip):
    _exception, event = await _raise(db_session, audit_trip)
    _other_exception, other_event = await _raise(db_session, audit_trip, label="other")
    other_receipt = await _anchor(db_session, audit_trip, other_event)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id, receipt_id=other_receipt.id,
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT



async def test_a_photo_whose_hash_changed_is_not_linked_to_the_receipt_that_committed_the_old_hash(
    db_session, audit_trip,
):
    exception, event = await _raise(db_session, audit_trip, photos=2)
    await _anchor(db_session, audit_trip, event)
    [tampered_id, intact_id] = [p["artifact_id"] for p in event.payload_json["photos"]]
    tampered = await db_session.get(type(audit_trip.seal_photo), uuid.UUID(tampered_id))
    tampered.file_hash = hashlib.sha256(b"swapped").hexdigest()
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    by_id = {str(p.artifact_id): p for p in record.photos}
    assert by_id[tampered_id].tier == "recorded"
    assert by_id[tampered_id].anchor_event_id is None and by_id[tampered_id].anchor_receipt_id is None
    assert by_id[intact_id].anchor_receipt_id == event.receipt_id


async def test_a_receipt_of_the_wrong_kind_does_not_make_an_action_anchored(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    receipt = await _anchor(db_session, audit_trip, event)
    receipt.receipt_type = BlockchainReceiptType.TRIP_CANCELLED
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "recorded"
    assert {p.tier for p in record.photos} == {"recorded"}
    assert record.anchors[0].tier == "recorded"
    assert {p.anchor_receipt_id for p in record.photos} == {None}


async def test_a_receipt_reassigned_to_another_subject_does_not_make_an_action_anchored(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    _other, other_event = await _raise(db_session, audit_trip, label="other")
    receipt = await _anchor(db_session, audit_trip, event)
    receipt.subject_id = other_event.id
    await db_session.flush()

    record = _record(await _build(db_session, audit_trip), exception)

    assert record.tier == "recorded"
    assert record.anchors[0].tier == "recorded"


async def test_a_receipt_on_a_different_subject_type_does_not_make_an_action_anchored(db_session, audit_trip):
    exception, event = await _raise(db_session, audit_trip)
    receipt = await _anchor(db_session, audit_trip, event)
    receipt.subject_type = SubjectType.TRIP
    await db_session.flush()

    assert _record(await _build(db_session, audit_trip), exception).tier == "recorded"


async def test_a_cancellation_is_not_anchored_once_the_trip_is_no_longer_cancelled(db_session, audit_trip):
    note = TripException(
        id=uuid.uuid4(), trip_id=audit_trip.trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        description=f"Cancelled by user {audit_trip.dispatcher.id}: vehicle hijacked",
        review_status=ExceptionReviewStatus.REVIEWED, review_outcome=ExceptionReviewOutcome.DISPATCHER_AUTHORED,
        reviewed_by_user_id=audit_trip.dispatcher.id, reviewed_at=audit_trip.trip.closed_at,
        created_at=audit_trip.trip.closed_at,
    )
    db_session.add(note)
    await db_session.flush()
    events = await prepare_exception_anchors(db_session, exception=note, cancelled_trip=audit_trip.trip)
    cancelled = next(e for e in events if e.receipt_type == BlockchainReceiptType.TRIP_CANCELLED)
    await _anchor(db_session, audit_trip, cancelled)
    audit_trip.trip.status = TripStatus.CANCELLED
    await db_session.flush()
    still_cancelled = {a.action: a.tier for a in _record(await _build(db_session, audit_trip), note).anchors}

    audit_trip.trip.status = TripStatus.ACTIVE
    await db_session.flush()
    reactivated = {a.action: a.tier for a in _record(await _build(db_session, audit_trip), note).anchors}

    assert still_cancelled["cancelled"] == "anchored"
    assert reactivated["cancelled"] == "recorded"


async def test_a_receipt_owned_by_another_trip_does_not_make_an_action_anchored(db_session, audit_trip):
    from app.orchestration.audit_packs.anchor_tiers import assess_exception_anchors
    from app.orchestration.evidence_anchors.artifacts import load_exception_artifacts

    exception, event = await _raise(db_session, audit_trip)
    receipt = await _anchor(db_session, audit_trip, event)
    photos = await load_exception_artifacts(db_session, exception=exception)
    intact = assess_exception_anchors(exception, audit_trip.trip, photos, [event], {receipt.id: receipt})
    receipt.trip_id = uuid.uuid4()

    foreign = assess_exception_anchors(exception, audit_trip.trip, photos, [event], {receipt.id: receipt})

    assert intact.tier == "anchored"
    assert foreign.tier == "recorded" and {p.tier for p in foreign.photos} == {"recorded"}
    assert {p.anchor_receipt_id for p in foreign.photos} == {None}


async def test_verifier_rejects_a_cancellation_once_the_trip_is_reopened(db_session, audit_trip):
    note = TripException(
        id=uuid.uuid4(), trip_id=audit_trip.trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        description=f"Cancelled by user {audit_trip.dispatcher.id}: x",
        review_status=ExceptionReviewStatus.REVIEWED, review_outcome=ExceptionReviewOutcome.DISPATCHER_AUTHORED,
        reviewed_by_user_id=audit_trip.dispatcher.id, reviewed_at=audit_trip.trip.closed_at,
        created_at=audit_trip.trip.closed_at,
    )
    audit_trip.trip.status = TripStatus.CANCELLED
    db_session.add(note)
    await db_session.flush()
    events = await prepare_exception_anchors(db_session, exception=note, cancelled_trip=audit_trip.trip)
    cancelled = next(e for e in events if e.receipt_type == BlockchainReceiptType.TRIP_CANCELLED)
    await _anchor(db_session, audit_trip, cancelled)

    async def verdict() -> VerifyStatus:
        with patch("app.orchestration.verification.service.HederaService") as service:
            service.return_value.verify_hash.return_value = True
            outcome = await verify_subject(
                db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=cancelled.id,
            )
        return VerifyStatus(outcome.status)

    while_cancelled = await verdict()
    audit_trip.trip.status = TripStatus.ACTIVE
    await db_session.flush()
    after_reopen = await verdict()

    assert while_cancelled == VerifyStatus.VERIFIED
    assert after_reopen == VerifyStatus.DB_MISMATCH
