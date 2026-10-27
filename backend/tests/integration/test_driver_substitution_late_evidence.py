"""FP-83 C4: late evidence is retained for review and never becomes a live write."""

import hashlib
import json
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    IdempotencyKeyReusedError, ResourceNotFoundError, SubstitutionInvalidError, SubstitutionVersionChangedError,
)
from app.db.models.driver_substitutions import LateDriverEvidence
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Trip
from app.orchestration.substitutions.access import get_current_custody
from app.orchestration.substitutions.artifacts import create_late_evidence_artifact
from app.orchestration.substitutions.late_evidence import acknowledge_late_evidence, retain_late_evidence
from app.schemas.driver_substitutions import (
    AcknowledgeLateEvidenceRequest, LateCheckpointEvidence, LateEvidenceKind, LateEvidenceRequest, LateEvidenceStatus,
    LateExceptionEvidence,
)
from app.schemas.transit import DriverCheckpointCreateBody, DriverExceptionCreateBody
from tests.integration._driver_substitution_world import SubWorld, build_world, chain_length, complete_handover
from tests.integration.test_driver_substitution_artifacts import storage, upload  # noqa: F401 - storage is a fixture
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, clock, dispatcher, driver_actor, get_row,
)

CAPTURED = NOW - timedelta(minutes=30)


def late(sequence: int = 0, *, key: uuid.UUID | None = None, artifacts: list[uuid.UUID] | None = None,
         note: str = "Flat tyre on N3") -> LateEvidenceRequest:
    return LateEvidenceRequest(
        client_request_id=key or uuid.uuid4(), custody_sequence=sequence, captured_at=CAPTURED,
        original_idempotency_key="queued-1",
        evidence=LateExceptionEvidence(
            kind=LateEvidenceKind.EXCEPTION,
            payload=DriverExceptionCreateBody(exception_type="mechanical", description=note),
        ),
        artifact_ids=artifacts or [],
    )


async def handed_over(db: AsyncSession) -> SubWorld:
    w = await build_world(db)
    await complete_handover(db, w, outgoing=w.a, incoming=w.b)
    return w


async def retain(db: AsyncSession, w: SubWorld, driver_id: uuid.UUID, body: LateEvidenceRequest):
    return await retain_late_evidence(db, trip_id=w.trip_id, driver=await driver_actor(db, driver_id), payload=body)


async def snapshot(db: AsyncSession, w: SubWorld) -> tuple:
    """What late evidence must never change: phases, custody, chain, live checkpoints/exceptions."""
    trip = await get_row(db, Trip, w.trip_id)
    phases = (await db.execute(
        select(PhaseEvent.sequence_number, PhaseEvent.status).where(PhaseEvent.trip_id == w.trip_id)
        .order_by(PhaseEvent.sequence_number)
    )).all()
    live = [
        len((await db.execute(select(model).where(model.trip_id == w.trip_id))).scalars().all())
        for model in (Checkpoint, TripException)
    ]
    return ([tuple(p) for p in phases], await get_current_custody(db, trip=trip),
            await chain_length(db, w.trip_id), live)


@pytest.mark.usefixtures("storage")
async def test_late_capture_receipt_does_not_advance_phase(db_session: AsyncSession):
    w = await handed_over(db_session)
    before = await snapshot(db_session, w)
    photo = await create_late_evidence_artifact(
        db_session, trip_id=w.trip_id, driver=await driver_actor(db_session, w.a), custody_sequence=0, upload=upload(),
    )

    receipt = await retain(db_session, w, w.a, late(artifacts=[photo.id]))

    assert receipt.status is LateEvidenceStatus.AWAITING_REVIEW
    assert (receipt.driver_id, receipt.custody_sequence, receipt.artifact_ids) == (w.a, 0, [photo.id])
    assert receipt.captured_at == CAPTURED and receipt.received_at == NOW
    row = await get_row(db_session, LateDriverEvidence, receipt.id)
    assert row.kind == "exception" and row.original_idempotency_key == "queued-1"
    canonical = json.dumps(row.evidence_json, sort_keys=True, separators=(",", ":"))
    assert row.payload_sha256 == hashlib.sha256(canonical.encode()).hexdigest()
    assert row.evidence_json["payload"]["description"] == "Flat tyre on N3"
    assert await snapshot(db_session, w) == before


async def test_a_checkpoint_payload_is_kept_verbatim_not_logged(db_session: AsyncSession):
    w = await handed_over(db_session)
    body = late().model_copy(update={"evidence": LateCheckpointEvidence(
        kind=LateEvidenceKind.CHECKPOINT, payload=DriverCheckpointCreateBody(checkpoint_type="routine"),
    )})

    receipt = await retain(db_session, w, w.a, body)

    assert (await get_row(db_session, LateDriverEvidence, receipt.id)).kind == "checkpoint"
    assert (await db_session.execute(select(Checkpoint).where(Checkpoint.trip_id == w.trip_id))).first() is None


async def test_an_exact_retry_returns_the_same_receipt(db_session: AsyncSession):
    w = await handed_over(db_session)
    body = late()

    first = await retain(db_session, w, w.a, body)
    again = await retain(db_session, w, w.a, body)

    assert again == first
    assert len((await db_session.execute(select(LateDriverEvidence))).scalars().all()) == 1


async def test_the_same_key_with_a_changed_payload_is_refused(db_session: AsyncSession):
    w = await handed_over(db_session)
    key = uuid.uuid4()
    await retain(db_session, w, w.a, late(key=key))

    with pytest.raises(IdempotencyKeyReusedError):
        await retain(db_session, w, w.a, late(key=key, note="Something else"))


async def test_the_claimed_period_must_be_the_callers_own_and_no_longer_current(db_session: AsyncSession):
    w = await handed_over(db_session)

    with pytest.raises(SubstitutionInvalidError):
        await retain(db_session, w, w.a, late(1))
    with pytest.raises(SubstitutionInvalidError):
        await retain(db_session, w, w.b, late(1))
    with pytest.raises(ResourceNotFoundError):
        await retain(db_session, w, w.c, late(0))

    assert (await db_session.execute(select(LateDriverEvidence))).first() is None


async def test_a_driver_who_returned_can_still_file_their_first_periods_evidence(db_session: AsyncSession):
    w = await handed_over(db_session)
    await complete_handover(db_session, w, outgoing=w.b, incoming=w.a)

    receipt = await retain(db_session, w, w.a, late(0))

    assert receipt.custody_sequence == 0


@pytest.mark.usefixtures("storage")
async def test_only_the_callers_own_unused_late_uploads_for_that_period_can_be_attached(db_session: AsyncSession):
    w = await handed_over(db_session)
    await complete_handover(db_session, w, outgoing=w.b, incoming=w.c)
    a_photo = await create_late_evidence_artifact(
        db_session, trip_id=w.trip_id, driver=await driver_actor(db_session, w.a), custody_sequence=0, upload=upload(),
    )
    b_photo = await create_late_evidence_artifact(
        db_session, trip_id=w.trip_id, driver=await driver_actor(db_session, w.b), custody_sequence=1, upload=upload(),
    )
    await retain(db_session, w, w.a, late(artifacts=[a_photo.id]))

    with pytest.raises(SubstitutionInvalidError):
        await retain(db_session, w, w.a, late(artifacts=[a_photo.id]))
    with pytest.raises(SubstitutionInvalidError):
        await retain(db_session, w, w.a, late(artifacts=[b_photo.id]))



def ack(key: uuid.UUID | None = None, note: str = "Reviewed with the driver") -> AcknowledgeLateEvidenceRequest:
    return AcknowledgeLateEvidenceRequest(client_request_id=key or uuid.uuid4(), note=note)


async def test_acknowledgement_changes_only_the_review_fields(db_session: AsyncSession):
    w = await handed_over(db_session)
    receipt = await retain(db_session, w, w.a, late())
    stored = await get_row(db_session, LateDriverEvidence, receipt.id)
    evidence_before, hash_before = dict(stored.evidence_json), stored.payload_sha256
    before = await snapshot(db_session, w)

    read = await acknowledge_late_evidence(
        db_session, trip_id=w.trip_id, evidence_id=receipt.id, actor=dispatcher(w), payload=ack(),
    )

    assert read.status is LateEvidenceStatus.ACKNOWLEDGED
    assert (read.reviewed_by_user_id, read.reviewed_at, read.review_note) == (w.user_id, NOW, "Reviewed with the driver")
    await db_session.refresh(stored)
    assert (stored.evidence_json, stored.payload_sha256) == (evidence_before, hash_before)
    assert await snapshot(db_session, w) == before


async def test_acknowledgement_replay_and_second_review(db_session: AsyncSession):
    w = await handed_over(db_session)
    receipt = await retain(db_session, w, w.a, late())
    body = ack()
    first = await acknowledge_late_evidence(
        db_session, trip_id=w.trip_id, evidence_id=receipt.id, actor=dispatcher(w), payload=body,
    )

    again = await acknowledge_late_evidence(
        db_session, trip_id=w.trip_id, evidence_id=receipt.id, actor=dispatcher(w), payload=body,
    )
    assert again == first
    with pytest.raises(SubstitutionVersionChangedError):
        await acknowledge_late_evidence(
            db_session, trip_id=w.trip_id, evidence_id=receipt.id, actor=dispatcher(w), payload=ack(note="Again"),
        )


async def test_another_organisation_cannot_acknowledge(db_session: AsyncSession):
    w = await handed_over(db_session)
    receipt = await retain(db_session, w, w.a, late())

    with pytest.raises(ResourceNotFoundError):
        await acknowledge_late_evidence(
            db_session, trip_id=w.trip_id, evidence_id=receipt.id,
            actor=dispatcher(w, organization_id=w.other_org_id), payload=ack(),
        )

@pytest.mark.usefixtures('storage')
async def test_ordinary_upload_before_transfer_can_be_retained_once(db_session: AsyncSession):
    from app.db.models.enums import ArtifactType
    from app.orchestration.evidence.artifacts import create_artifact
    from tests.integration.test_driver_substitution_artifacts import jpeg

    w = await build_world(db_session)
    photo = await create_artifact(
        db_session, trip_id=w.trip_id, file_bytes=jpeg(), mime_type='image/jpeg',
        artifact_type=ArtifactType.PHOTO, captured_at=CAPTURED, captured_by_driver_id=w.a, custody_sequence=0,
    )
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    before = await snapshot(db_session, w)
    payload = late(artifacts=[photo.id])

    receipt = await retain(db_session, w, w.a, payload)
    replay = await retain(db_session, w, w.a, payload)

    assert receipt.id == replay.id
    assert receipt.artifact_ids == [photo.id]
    assert await snapshot(db_session, w) == before
