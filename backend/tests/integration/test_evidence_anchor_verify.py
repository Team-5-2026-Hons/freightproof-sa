"""FP-290 Task 1: verifying an evidence anchor rebuilds it from live rows and live bytes.

Every case anchors a critical two-photo report through the worker entry point, then changes
exactly one thing and asks the shared verifier. Storage and the Hedera mirror are stubbed at
their module boundaries; nothing here reaches the network.
"""

import uuid
from collections.abc import Callable
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, update

from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import (
    ExceptionSeverity, ExceptionType, SubjectType, VerifyStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent, ExceptionArtifact
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.execution import anchor_evidence_event
from app.orchestration.exceptions.creation import raise_exception
from app.orchestration.verification.service import verify_subject, verify_visible_subject
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError, EvidenceStorageUnavailableError,
)

from tests.integration._evidence_anchor_world import World, make_artifact, seed_world

_HASH_FN = "app.orchestration.verification.evidence_payloads.hash_stored_evidence_file"


class Stored:
    """Plain copy of an artifact's identifying values, safe to read after expire_all()."""
    def __init__(self, artifact: EvidenceArtifact) -> None:
        self.id, self.s3_key, self.file_hash = artifact.id, artifact.s3_key, artifact.file_hash


class Scenario:
    def __init__(self, world: World, event_id: uuid.UUID, exception_id: uuid.UUID,
                 artifacts: list[Stored]) -> None:
        self.world, self.event_id, self.exception_id, self.artifacts = world, event_id, exception_id, artifacts
        self.org_id, self.trip_id = world.org.id, world.trip.id


@pytest_asyncio.fixture
async def anchored(db_session) -> Scenario:
    world = await seed_world(db_session)
    artifacts = [await make_artifact(db_session, world.trip.id) for _ in range(2)]
    report = await raise_exception(
        db_session, trip_id=world.trip.id, driver_id=world.driver.id,
        exception_type=ExceptionType.SEAL_BROKEN_IN_TRANSIT, description="Seal cut open.",
        supporting_artifact_id=None, supporting_artifact_ids=[a.id for a in artifacts],
        gps_lat=Decimal("-26.0942"), gps_lng=Decimal("28.1342"),
    )
    event_id = report.anchor_events[0].event_id
    assert await anchor_evidence_event(db_session, event_id=event_id) is True
    return Scenario(world, event_id, report.id, [Stored(a) for a in artifacts])


@contextmanager
def stored_bytes(artifacts: list[Stored], overrides: dict[str, object] | None = None):
    """Storage returns each artifact's recorded hash unless a key is overridden."""
    overrides = overrides or {}

    async def fake(*, s3_bucket: str, s3_key: str) -> str:
        outcome = overrides.get(s3_key)
        if isinstance(outcome, BaseException):
            raise outcome
        if isinstance(outcome, str):
            return outcome
        return next(a.file_hash for a in artifacts if a.s3_key == s3_key)

    with patch(_HASH_FN, new=AsyncMock(side_effect=fake)) as mocked:
        yield mocked


def _mirror(match: bool = True) -> MagicMock:
    service = MagicMock()
    service.verify_hash.return_value = match
    return service


async def _verify(db, scenario: Scenario, **kwargs):
    return await verify_subject(
        db, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=scenario.event_id,
        hedera_service=_mirror(), **kwargs,
    )


async def test_untouched_report_verifies_and_checks_both_photos_bytes(db_session, anchored):
    with stored_bytes(anchored.artifacts) as storage:
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is True
    assert {call.kwargs["s3_key"] for call in storage.await_args_list} == {
        a.s3_key for a in anchored.artifacts}


async def _set(db, scenario: Scenario, **values: object) -> None:
    await db.execute(update(TripException).where(TripException.id == scenario.exception_id).values(**values))
    db.expire_all()


@pytest.mark.parametrize("change", [
    {"description": "Seal intact, nothing happened."},
    {"severity": ExceptionSeverity.WARNING.value},
    {"exception_type": ExceptionType.CARGO_DAMAGE.value},
], ids=["description", "severity", "type"])
async def test_edited_source_fields_are_a_db_mismatch(db_session, anchored, change):
    await _set(db_session, anchored, **change)

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_changed_context_is_a_db_mismatch(db_session, anchored):
    from app.db.models.enums import PhaseStatus, PhaseType
    from app.db.models.phases import PhaseEvent

    phase = PhaseEvent(
        id=uuid.uuid4(), trip_id=anchored.trip_id, phase_type=PhaseType.IN_TRANSIT,
        sequence_number=1, status=PhaseStatus.PENDING,
    )
    db_session.add(phase)
    await db_session.flush()
    await _set(db_session, anchored, phase_event_id=phase.id)

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_removed_member_is_a_db_mismatch(db_session, anchored):
    await db_session.execute(delete(ExceptionArtifact).where(
        ExceptionArtifact.artifact_id == anchored.artifacts[1].id))
    db_session.expire_all()

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_added_member_is_a_db_mismatch(db_session, anchored):
    extra = await make_artifact(db_session, anchored.trip_id)
    db_session.add(ExceptionArtifact(exception_id=anchored.exception_id, artifact_id=extra.id, position=2))
    await db_session.flush()

    with stored_bytes(anchored.artifacts + [Stored(extra)]):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_replaced_file_bytes_are_a_db_mismatch(db_session, anchored):
    with stored_bytes(anchored.artifacts, {anchored.artifacts[0].s3_key: "f" * 64}):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_edited_artifact_hash_row_is_a_db_mismatch(db_session, anchored):
    await db_session.execute(update(EvidenceArtifact).where(
        EvidenceArtifact.id == anchored.artifacts[0].id).values(file_hash="e" * 64))
    db_session.expire_all()

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_deleted_object_is_a_db_mismatch(db_session, anchored):
    missing = EvidenceObjectIntegrityError("object missing")
    with stored_bytes(anchored.artifacts, {anchored.artifacts[1].s3_key: missing}):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_gps_only_edit_still_verifies(db_session, anchored):
    await _set(
        db_session, anchored, gps_lat=Decimal("-33.9249000"), gps_lng=Decimal("18.4241000"),
        action_location_assessment={"driver_lat": -33.9, "reasons": ["edited"]},
    )
    await db_session.execute(update(EvidenceArtifact).where(
        EvidenceArtifact.trip_id == anchored.trip_id
    ).values(captured_lat=Decimal("1.0"), captured_lng=Decimal("2.0")))
    db_session.expire_all()

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.VERIFIED


async def test_storage_outage_is_an_error_not_a_mismatch(db_session, anchored):
    down = EvidenceStorageUnavailableError("storage down")
    with stored_bytes(anchored.artifacts, {anchored.artifacts[0].s3_key: down}):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.ERROR


async def test_mirror_mismatch_is_reported_as_hedera_mismatch(db_session, anchored):
    with stored_bytes(anchored.artifacts):
        outcome = await verify_subject(
            db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=anchored.event_id,
            hedera_service=_mirror(False),
        )

    assert outcome.status == VerifyStatus.HEDERA_MISMATCH


async def test_event_without_a_receipt_is_no_receipt(db_session):
    world = await seed_world(db_session)
    report = await raise_exception(
        db_session, trip_id=world.trip.id, driver_id=world.driver.id,
        exception_type=ExceptionType.PANIC_BUTTON, description="Panic.", supporting_artifact_id=None,
    )

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=report.anchor_events[0].event_id,
        hedera_service=_mirror(),
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT


@pytest.mark.parametrize("corrupt", [
    lambda p: p.pop("payload_version"),
    lambda p: p.update(payload_version=True),
    lambda p: p.update(payload_version="1"),
    lambda p: p.update(payload_version=2),
    lambda p: p.update(event_type="exception_reviewed"),
], ids=["missing", "bool", "string", "other", "wrong-kind"])
async def test_unsupported_receipt_payload_is_an_error(db_session, anchored, corrupt: Callable):
    from app.db.models.blockchain import BlockchainReceipt
    event = await db_session.get(EvidenceAnchorEvent, anchored.event_id)
    receipt = await db_session.get(BlockchainReceipt, event.receipt_id)
    payload = dict(receipt.payload_json)
    corrupt(payload)
    receipt.payload_json = payload
    await db_session.flush()

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.ERROR


async def test_other_organisations_event_is_404_before_storage_or_hedera(db_session, anchored):
    stranger = await seed_world(db_session, tag="B")

    with stored_bytes(anchored.artifacts) as storage, patch(
        "app.orchestration.verification.service.HederaService"
    ) as hedera:
        with pytest.raises(SubjectNotVisibleError):
            await verify_visible_subject(
                db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=anchored.event_id,
                organization_id=stranger.org.id,
            )

    storage.assert_not_awaited()
    hedera.assert_not_called()


async def test_owning_organisation_can_verify_through_the_visible_path(db_session, anchored):
    with stored_bytes(anchored.artifacts), patch(
        "app.orchestration.verification.service.HederaService"
    ) as hedera:
        hedera.return_value.verify_hash.return_value = True
        outcome = await verify_visible_subject(
            db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=anchored.event_id,
            organization_id=anchored.org_id,
        )

    assert outcome.status == VerifyStatus.VERIFIED


async def test_member_photo_moved_to_another_trip_is_a_mismatch_before_storage(db_session, anchored):
    other = await seed_world(db_session, tag="B")
    await db_session.execute(update(EvidenceArtifact).where(
        EvidenceArtifact.id == anchored.artifacts[0].id).values(trip_id=other.trip.id))
    db_session.expire_all()

    with stored_bytes(anchored.artifacts) as storage:
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH
    storage.assert_not_awaited()


async def test_legacy_photo_on_another_trip_is_a_mismatch_before_storage(db_session, anchored):
    other = await seed_world(db_session, tag="B")
    foreign = await make_artifact(db_session, other.trip.id)
    await db_session.execute(delete(ExceptionArtifact).where(
        ExceptionArtifact.exception_id == anchored.exception_id))
    await _set(db_session, anchored, supporting_artifact_id=foreign.id)

    with stored_bytes(anchored.artifacts) as storage:
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.DB_MISMATCH
    storage.assert_not_awaited()


@pytest.mark.parametrize("corrupt", [
    lambda p: p.update(event_type=["exception_raised"]),
    lambda p: p.update(event_type={"a": 1}),
], ids=["list-kind", "object-kind"])
async def test_malformed_event_kind_in_receipt_is_an_error(db_session, anchored, corrupt: Callable):
    from app.db.models.blockchain import BlockchainReceipt
    event = await db_session.get(EvidenceAnchorEvent, anchored.event_id)
    receipt = await db_session.get(BlockchainReceipt, event.receipt_id)
    payload = dict(receipt.payload_json)
    corrupt(payload)
    receipt.payload_json = payload
    await db_session.flush()

    with stored_bytes(anchored.artifacts):
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.ERROR


async def test_unknown_persisted_receipt_type_on_the_event_is_an_error(db_session, anchored):
    await db_session.execute(update(EvidenceAnchorEvent).where(
        EvidenceAnchorEvent.id == anchored.event_id
    ).values(receipt_type="not_a_receipt_type", anchor_status="anchored"))
    db_session.expire_all()

    with stored_bytes(anchored.artifacts) as storage:
        outcome = await _verify(db_session, anchored)

    assert outcome.status == VerifyStatus.ERROR
    storage.assert_not_awaited()
