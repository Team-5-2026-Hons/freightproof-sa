"""FP-290 end to end: one broken-seal incident, from the driver's report to the audit pack.

A critical broken-seal report with two photos is raised, then the trip is cancelled, then the
critical report is reviewed. Each of those is its own action with its own frozen event and its
own Hedera receipt; none of them may touch an earlier one. Hedera is switched off for the later
anchors to prove an outage leaves visible, recoverable debt rather than lost evidence, and a
newly issued, consignment-scoped audit pack is read at each stage to prove it says only what
is true at that moment.

Hedera is faked at the SDK adapter (tests/integration/conftest.py), so the real
anchor_subject / HederaService / execution / recovery code runs; the photo bytes are faked at
the storage boundary, and the pack PDF upload is kept in memory.
"""

import copy
import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain import hedera as hedera_module
from app.db.models.audit_packs import AuditPack
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, DispatcherReviewOutcome, ExceptionContactMethod,
    ExceptionReviewStatus, ExceptionType, SubjectType, TripStatus, VerifyStatus,
)
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.audit_packs import lifecycle
from app.orchestration.audit_packs.access import verify_shared_pack
from app.orchestration.audit_packs.builder import build_audit_manifest
from app.orchestration.audit_packs.lifecycle import issue_audit_pack
from app.orchestration.evidence_anchors.execution import anchor_evidence_event
from app.orchestration.evidence_anchors.recovery import recover_evidence_anchor
from app.orchestration.exceptions.creation import raise_exception
from app.orchestration.exceptions.review import review_exception
from app.orchestration.trips.administration import cancel_trip
from app.orchestration.verification.service import verify_subject
from app.schemas.audit_pack import AuditPackCreate, AuditPackManifest, AuditPackOptions
from app.schemas.people import UserRead
from app.storage.supabase_storage import UploadResult

from tests.integration._audit_pack_anchor_helpers import anchor_event as _anchor_synthetic
from tests.integration._audit_pack_anchor_helpers import raise_critical as _raise_for_consignment
from tests.integration.audit_pack_seed import AuditTrip, _artifact, seed_audit_trip

# Renders no real PDF unless a test is marked real_pdf (see fake_pdf_renderer in conftest.py).
pytestmark = pytest.mark.usefixtures("fake_pdf_renderer")

_HASH_FN = "app.orchestration.verification.evidence_payloads.hash_stored_evidence_file"
_PHOTO_LABELS = ("seal-cut-close-up", "seal-cut-wide-shot")
_EVIDENCE_EVENT = SubjectType.EVIDENCE_EVENT.value
_RECOVERY_WINDOW = timedelta(hours=1)


# ── Fixtures ──────────────────────────────────────────────────────────────────

class HederaSwitch:
    """Turns the faked Hedera SDK off and on, so the real failure handling runs."""

    def __init__(self) -> None:
        self.down = False


@pytest.fixture
def hedera(monkeypatch: pytest.MonkeyPatch) -> HederaSwitch:
    switch = HederaSwitch()
    adapter = hedera_module._SdkHederaAdapter  # the stub installed by tests/integration/conftest.py
    healthy_submit = adapter.submit_message

    def submit_message(
        self: hedera_module._SdkHederaAdapter, topic_id: str, message: str,
    ) -> hedera_module.HederaReceipt:
        if switch.down:
            raise ConnectionError("hedera unreachable")
        return healthy_submit(self, topic_id, message)

    monkeypatch.setattr(adapter, "submit_message", submit_message)
    return switch


@pytest.fixture
def photo_storage(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Storage holds each seeded photo under `<label>.jpg`, whose bytes hash to the recorded
    file_hash. Every byte-hash request is recorded so a test can see which files were read."""
    async def stored_hash(*, s3_bucket: str, s3_key: str) -> str:
        return hashlib.sha256(s3_key.removesuffix(".jpg").encode()).hexdigest()

    storage = AsyncMock(side_effect=stored_hash)
    monkeypatch.setattr(_HASH_FN, storage)
    return storage


@pytest.fixture
def stored_pdfs(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    store: dict[str, bytes] = {}

    async def fake_upload(*, trip_id: str, pack_id: str, pdf_bytes: bytes) -> UploadResult:
        key = f"audit-packs/{trip_id}/{pack_id}.pdf"
        store[key] = pdf_bytes
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=key, file_hash=hashlib.sha256(pdf_bytes).hexdigest())

    monkeypatch.setattr(lifecycle, "upload_audit_pack_pdf", fake_upload)
    return store


@dataclass(frozen=True)
class Anchored:
    """Plain copy of an event and its receipt, safe to compare after expire_all()."""
    event_hash: str
    payload: dict
    anchor_status: str
    receipt_id: uuid.UUID | None
    data_hash: str | None
    hedera_tx_id: str | None
    hedera_sequence_number: int | None
    receipt_payload: dict | None


async def snapshot(db: AsyncSession, event_id: uuid.UUID) -> Anchored:
    # populate_existing re-reads the row instead of trusting the session's cached copy, without
    # expiring the whole session (which would make the seed's ORM objects unreadable here).
    event = (await db.execute(
        select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id).execution_options(populate_existing=True)
    )).scalar_one()
    receipt = None
    if event.receipt_id is not None:
        receipt = (await db.execute(
            select(BlockchainReceipt).where(BlockchainReceipt.id == event.receipt_id)
            .execution_options(populate_existing=True)
        )).scalar_one()
    return Anchored(
        event_hash=event.event_hash, payload=copy.deepcopy(event.payload_json),
        anchor_status=str(getattr(event.anchor_status, "value", event.anchor_status)),
        receipt_id=event.receipt_id,
        data_hash=receipt.data_hash if receipt else None,
        hedera_tx_id=receipt.hedera_tx_id if receipt else None,
        hedera_sequence_number=receipt.hedera_sequence_number if receipt else None,
        receipt_payload=copy.deepcopy(receipt.payload_json) if receipt else None,
    )


@dataclass
class Incident:
    seed: AuditTrip
    report_id: uuid.UUID
    note_id: uuid.UUID
    photo_keys: tuple[str, str]
    photo_ids: tuple[uuid.UUID, uuid.UUID]
    raise_event: uuid.UUID
    cancel_event: uuid.UUID
    cancel_review_event: uuid.UUID
    report_review_event: uuid.UUID
    raise_anchored: Anchored  # the raise receipt as it was before the cancellation and the review
    other_client_receipt: uuid.UUID  # a critical report pinned to the OTHER client's consignment
    issued_by: UserRead

    @property
    def later_events(self) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
        return self.cancel_event, self.cancel_review_event, self.report_review_event

    @property
    def all_events(self) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
        return self.raise_event, *self.later_events


async def _events_by_kind(db: AsyncSession, trip_id: uuid.UUID) -> dict[tuple[uuid.UUID, str], uuid.UUID]:
    rows = (await db.execute(
        select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.trip_id == trip_id)
    )).scalars().all()
    return {(e.exception_id, str(getattr(e.receipt_type, "value", e.receipt_type))): e.id for e in rows}


@pytest_asyncio.fixture
async def incident(db_session, hedera, photo_storage, stored_pdfs) -> Incident:
    """Raise (anchored) → cancel → review. The three later events are left pending."""
    seed = await seed_audit_trip(db_session)
    trip_id, org_id, dispatcher_id = seed.trip.id, seed.org.id, seed.dispatcher.id
    issued_by = UserRead.model_validate(seed.dispatcher)  # read now: later actions refresh the ORM rows
    # The seed trip is a finished journey; this incident happens while it is still underway.
    await db_session.execute(update(Trip).where(Trip.id == trip_id).values(status=TripStatus.ACTIVE, closed_at=None))
    photos = [_artifact(trip_id, label, datetime.now(UTC)) for label in _PHOTO_LABELS]
    db_session.add_all(photos)
    await db_session.flush()

    report = await raise_exception(
        db_session, trip_id=trip_id, driver_id=seed.driver.id,
        exception_type=ExceptionType.SEAL_BROKEN_IN_TRANSIT, description="Seal found cut open at the weighbridge.",
        supporting_artifact_id=None, supporting_artifact_ids=[p.id for p in photos],
    )
    raise_event = report.anchor_events[0].event_id
    assert await anchor_evidence_event(db_session, event_id=raise_event) is True
    raise_anchored = await snapshot(db_session, raise_event)

    await cancel_trip(
        db_session, trip_id=trip_id, operator_organization_id=org_id, user_id=dispatcher_id,
        note="Load recovered by SAPS; trip abandoned.",
    )
    await review_exception(
        db_session, exception_id=report.id, user_id=dispatcher_id, organization_id=org_id,
        review_note="Spoke to the driver and SAPS; seal cut, cargo count unchanged.",
        review_outcome=DispatcherReviewOutcome.EVIDENCE_VERIFIED, contact_method=ExceptionContactMethod.PHONE,
    )

    events = await _events_by_kind(db_session, trip_id)
    cancel_event = next(i for (_, kind), i in events.items() if kind == BlockchainReceiptType.TRIP_CANCELLED.value)
    note_id = next(ex for (ex, kind) in events if kind == BlockchainReceiptType.TRIP_CANCELLED.value)

    # A different client's critical report on the same trip, already anchored: a scoped pack
    # for the first client must not show it.
    other_exception, other_event = await _raise_for_consignment(
        db_session, seed, photos=1, consignment_id=seed.consignment_b.id, label="other-client",
    )
    other_receipt = await _anchor_synthetic(db_session, seed, other_event)

    return Incident(
        seed=seed, report_id=report.id, note_id=note_id,
        photo_keys=(f"{_PHOTO_LABELS[0]}.jpg", f"{_PHOTO_LABELS[1]}.jpg"), photo_ids=(photos[0].id, photos[1].id),
        raise_event=raise_event, cancel_event=cancel_event,
        cancel_review_event=events[(note_id, BlockchainReceiptType.EXCEPTION_REVIEWED.value)],
        report_review_event=events[(report.id, BlockchainReceiptType.EXCEPTION_REVIEWED.value)],
        raise_anchored=raise_anchored, other_client_receipt=other_receipt.id,
        issued_by=issued_by,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _issue_scoped_pack(db: AsyncSession, incident: Incident) -> AuditPack:
    """A newly issued pack scoped to the first client's consignment, as a dispatcher would."""
    issued = await issue_audit_pack(
        db, trip_id=incident.seed.trip.id, issued_by=incident.issued_by,
        request=AuditPackCreate.model_validate(dict(
            recipient_name="Jane Adjuster", recipient_organization="Santam Claims",
            recipient_email="jane@santam.example", purpose="insurance_claim", external_reference="CLM-290",
            scope_consignment_id=incident.seed.consignment_a.id,
        )),
    )
    return issued.pack


def _manifest(pack: AuditPack) -> AuditPackManifest:
    return AuditPackManifest.model_validate(pack.manifest_json)


def _record(manifest: AuditPackManifest, exception_id: uuid.UUID):
    return next(e for e in manifest.exceptions if e.exception_id == exception_id)


def _evidence_receipts(manifest: AuditPackManifest) -> set[uuid.UUID]:
    return {r.receipt_id for r in manifest.anchored_records if r.subject_type == _EVIDENCE_EVENT}


def _action_status(manifest: AuditPackManifest, exception_id: uuid.UUID) -> dict[str, tuple[str, str]]:
    """action -> (anchor_status, tier) for one exception in the pack."""
    return {a.action: (a.anchor_status, a.tier) for a in _record(manifest, exception_id).anchors}


async def _anchor_later_events(db: AsyncSession, incident: Incident) -> list[bool]:
    return [await anchor_evidence_event(db, event_id=event_id) for event_id in incident.later_events]


async def _recover_everything(db: AsyncSession) -> int:
    recovered = 0
    while (outcome := await recover_evidence_anchor(db, due_before=datetime.now(UTC) + _RECOVERY_WINDOW)) is not None:
        recovered += 1 if outcome else 0
        if not outcome:
            break
    return recovered


# ── The chain ─────────────────────────────────────────────────────────────────

async def test_each_action_has_its_own_event_and_receipts_stay_separate(db_session, incident):
    # Arrange: the raise is anchored; cancel, cancel-note review and report review are not yet.
    assert await _anchor_later_events(db_session, incident) == [True, True, True]

    # Act
    snapshots = [await snapshot(db_session, event_id) for event_id in incident.all_events]

    # Assert: four events, four receipts, four different commitments
    assert len(set(incident.all_events)) == 4
    assert len({s.receipt_id for s in snapshots}) == 4
    assert len({s.data_hash for s in snapshots}) == 4
    assert len({s.hedera_tx_id for s in snapshots}) == 4
    kinds = {
        (e.exception_id, str(getattr(e.receipt_type, "value", e.receipt_type)))
        for e in (await db_session.execute(
            select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id.in_(incident.all_events))
        )).scalars()
    }
    assert kinds == {
        (incident.report_id, "exception_raised"),
        (incident.report_id, "exception_reviewed"),
        (incident.note_id, "trip_cancelled"),
        (incident.note_id, "exception_reviewed"),
    }
    # The cancellation and its authored review are about the note, not the broken-seal report.
    assert incident.note_id != incident.report_id
    for s in snapshots:
        assert s.anchor_status == "anchored" and s.receipt_payload == s.payload


async def test_later_actions_leave_the_original_raise_receipt_untouched(db_session, incident):
    await _anchor_later_events(db_session, incident)

    after = await snapshot(db_session, incident.raise_event)

    assert after == incident.raise_anchored
    # The report row now carries a review, yet the raise commitment excludes review fields,
    # so it still rebuilds to exactly what was anchored.
    outcome = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=incident.raise_event,
        hedera_service=MagicMock(verify_hash=MagicMock(return_value=True)),
    )
    assert outcome.status == VerifyStatus.VERIFIED


async def test_raise_verification_rehashes_both_photos_bytes(db_session, incident, photo_storage):
    mirror = MagicMock(verify_hash=MagicMock(return_value=True))

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=incident.raise_event,
        hedera_service=mirror, receipt_id=incident.raise_anchored.receipt_id,
    )

    assert outcome.status == VerifyStatus.VERIFIED and outcome.evidence_verified is True
    assert {call.kwargs["s3_key"] for call in photo_storage.await_args_list} == set(incident.photo_keys)
    assert {p["artifact_id"] for p in incident.raise_anchored.payload["photos"]} == {
        str(photo_id) for photo_id in incident.photo_ids}


async def test_pack_issued_before_the_later_anchors_shows_them_pending_not_anchored(db_session, incident):
    pack = await _issue_scoped_pack(db_session, incident)

    manifest = _manifest(pack)

    report = _record(manifest, incident.report_id)
    assert report.tier == "anchored"  # the raise receipt exists and is intact
    assert _action_status(manifest, incident.report_id) == {
        "raised": ("anchored", "anchored"), "reviewed": ("pending", "recorded"),
    }
    assert _action_status(manifest, incident.note_id) == {
        "cancelled": ("pending", "recorded"), "reviewed": ("pending", "recorded"),
    }
    assert _evidence_receipts(manifest) == {incident.raise_anchored.receipt_id}
    assert {p.anchor_receipt_id for p in report.photos} == {incident.raise_anchored.receipt_id}


async def test_hedera_outage_leaves_failed_events_and_the_source_intact(db_session, incident, hedera):
    hedera.down = True

    results = await _anchor_later_events(db_session, incident)

    assert results == [False, False, False]
    for event_id in incident.later_events:
        failed = await snapshot(db_session, event_id)
        assert failed.anchor_status == "failed" and failed.receipt_id is None
    # Nothing was lost: the cancellation and the review stand, and the raise is still anchored.
    trip = await db_session.get(Trip, incident.seed.trip.id)
    report = await db_session.get(TripException, incident.report_id)
    assert trip is not None and trip.status == TripStatus.CANCELLED
    assert report is not None and report.review_status == ExceptionReviewStatus.REVIEWED
    assert await snapshot(db_session, incident.raise_event) == incident.raise_anchored


async def test_pack_issued_during_the_outage_says_failed_and_recovery_during_it_changes_nothing(
    db_session, incident, hedera,
):
    hedera.down = True
    await _anchor_later_events(db_session, incident)

    pack = await _issue_scoped_pack(db_session, incident)
    still_down = await recover_evidence_anchor(db_session, due_before=datetime.now(UTC) + _RECOVERY_WINDOW)

    manifest = _manifest(pack)
    assert _action_status(manifest, incident.report_id) == {
        "raised": ("anchored", "anchored"), "reviewed": ("failed", "recorded"),
    }
    assert _action_status(manifest, incident.note_id) == {
        "cancelled": ("failed", "recorded"), "reviewed": ("failed", "recorded"),
    }
    assert _evidence_receipts(manifest) == {incident.raise_anchored.receipt_id}
    assert still_down is False  # a sweep during the outage attempts one event and it stays owed
    for event_id in incident.later_events:
        assert (await snapshot(db_session, event_id)).receipt_id is None


async def test_recovery_anchors_the_failed_events_without_touching_the_raise(db_session, incident, hedera):
    hedera.down = True
    await _anchor_later_events(db_session, incident)
    hedera.down = False

    recovered = await _recover_everything(db_session)

    assert recovered == 3
    for event_id in incident.later_events:
        done = await snapshot(db_session, event_id)
        assert done.anchor_status == "anchored" and done.receipt_id is not None
        assert done.receipt_payload == done.payload
    assert await snapshot(db_session, incident.raise_event) == incident.raise_anchored
    # Debt cleared: a further sweep finds nothing to do.
    assert await recover_evidence_anchor(db_session, due_before=datetime.now(UTC) + _RECOVERY_WINDOW) is None


async def test_new_pack_after_recovery_has_exactly_the_right_receipts_and_both_photos(
    db_session, incident, hedera, photo_storage, monkeypatch,
):
    hedera.down = True
    await _anchor_later_events(db_session, incident)
    outage_pack_id = (await _issue_scoped_pack(db_session, incident)).id
    hedera.down = False
    await _recover_everything(db_session)
    receipts = {
        i: (await snapshot(db_session, i)).receipt_id for i in incident.all_events
    }

    pack = await _issue_scoped_pack(db_session, incident)
    manifest = _manifest(pack)

    # Exactly the four receipts of this incident: not the other client's, not a stale one.
    assert _evidence_receipts(manifest) == set(receipts.values())
    assert incident.other_client_receipt not in _evidence_receipts(manifest)
    assert _action_status(manifest, incident.report_id) == {
        "raised": ("anchored", "anchored"), "reviewed": ("anchored", "anchored"),
    }
    assert _action_status(manifest, incident.note_id) == {
        "cancelled": ("anchored", "anchored"), "reviewed": ("anchored", "anchored"),
    }
    report = _record(manifest, incident.report_id)
    assert [p.artifact_id for p in report.photos] == list(incident.photo_ids)
    assert {p.tier for p in report.photos} == {"anchored"}
    # Each photo is tied to the RAISE receipt, which committed it; the review receipt does not.
    assert {p.anchor_receipt_id for p in report.photos} == {receipts[incident.raise_event]}
    by_action = {a.action: a for a in report.anchors}
    assert by_action["raised"].receipt_id == receipts[incident.raise_event]
    assert by_action["reviewed"].receipt_id == receipts[incident.report_review_event]
    # The other client's report is cut from this scope entirely...
    assert incident.other_client_receipt not in {a.receipt_id for e in manifest.exceptions for a in e.anchors}
    # ...yet is in an unscoped pack, so its absence above is scoping, not a missing record.
    unscoped = await build_audit_manifest(
        db_session, trip_id=incident.seed.trip.id, operator_organization_id=incident.seed.org.id,
        options=AuditPackOptions(),
    )
    assert incident.other_client_receipt in _evidence_receipts(unscoped)

    # The packs issued earlier are frozen snapshots: recovery did not rewrite what they said.
    earlier = (await db_session.execute(
        select(AuditPack).where(AuditPack.id == outage_pack_id).execution_options(populate_existing=True)
    )).scalar_one()
    assert _action_status(_manifest(earlier), incident.note_id)["cancelled"] == ("failed", "recorded")

    # The shared-portal "Verify" re-checks every receipt in the pack against live rows and live
    # photo bytes; Hedera's mirror is faked to agree.
    photo_storage.reset_mock()
    portal_hedera = MagicMock(verify_hash=MagicMock(return_value=True))
    monkeypatch.setattr(
        "app.orchestration.audit_packs.access.HederaService", lambda *_a, **_k: portal_hedera,
    )
    live = await verify_shared_pack(db_session, pack)
    checks = {c.receipt_id: c.status for c in live.records if c.subject_type == _EVIDENCE_EVENT}
    assert checks == {receipt_id: "verified" for receipt_id in receipts.values()}
    assert {call.kwargs["s3_key"] for call in photo_storage.await_args_list} >= set(incident.photo_keys)
