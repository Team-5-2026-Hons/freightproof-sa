"""FP-83 C4: handover and late uploads, and capture ownership after a takeover.

Storage is replaced by a fake that records each call and hashes the real bytes, so "an exact
retry costs no upload" and "the same bytes" are both observable. Everything else is the real
service on the rolled-back `db_session`.
"""

import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    EvidenceAttributionError, IdempotencyKeyReusedError, ResourceNotFoundError, SubstitutionInvalidError,
    SubstitutionNotPendingError, SubstitutionVersionChangedError,
)
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmationArtifact, DriverSubstitutionRequest, DriverSubstitutionUpload,
)
from app.db.models.enums import ArtifactType, EvidenceRole, TripType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import Trip
from app.orchestration.evidence.artifacts import create_artifact
from app.orchestration.evidence.attribution import EvidenceAttribution
from app.orchestration.substitutions.artifacts import (
    HandoverUploadClaim, ValidatedArtifactUpload, create_late_evidence_artifact, create_substitution_artifact,
)
from app.orchestration.substitutions.service import cancel_substitution, confirm_substitution
from app.schemas.driver_substitutions import (
    CancelSubstitutionRequest, SealCheck, SubstitutionRequestRead, SubstitutionRole, SubstitutionSealCondition,
)
from app.storage.supabase_storage import UploadResult
from tests.integration._driver_substitution_world import SubWorld, build_world, complete_handover
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, armed, capture, clock, dispatcher, driver_actor, get_row,
)

JPEG = b"\xff\xd8\xff\xe0"


def jpeg() -> bytes:
    """A distinct, sniffable JPEG body each call."""
    return JPEG + os.urandom(64)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    calls: list[bytes] = []

    async def fake_upload(*, trip_id: str, file_bytes: bytes, mime_type: str) -> UploadResult:
        calls.append(file_bytes)
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}",
            file_hash=hashlib.sha256(file_bytes).hexdigest(),
        )

    monkeypatch.setattr("app.orchestration.substitutions.artifacts.upload_evidence_file", fake_upload)
    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake_upload)
    return calls


def upload(body: bytes | None = None, *, key: uuid.UUID | None = None, at: datetime | None = None) -> ValidatedArtifactUpload:
    return ValidatedArtifactUpload(
        client_request_id=key or uuid.uuid4(), file_bytes=body or jpeg(), mime_type="image/jpeg",
        artifact_type=ArtifactType.PHOTO, captured_at=at or NOW - timedelta(minutes=1),
    )


async def handover_upload(
    db: AsyncSession, w: SubWorld, read: SubstitutionRequestRead, driver_id: uuid.UUID,
    role: SubstitutionRole, body: ValidatedArtifactUpload | None = None,
):
    return await create_substitution_artifact(
        db, trip_id=w.trip_id, driver=await driver_actor(db, driver_id),
        claim=HandoverUploadClaim(request_id=read.id, role=role), upload=body or upload(),
    )


async def uploads(db: AsyncSession) -> list[DriverSubstitutionUpload]:
    return list((await db.execute(select(DriverSubstitutionUpload))).scalars())


def seal_with(w: SubWorld, photo: uuid.UUID) -> list[SealCheck]:
    return [SealCheck(vehicle_id=w.horse_id, condition=SubstitutionSealCondition.INTACT, seal_number="AB-1234",
                      photo_artifact_ids=[photo])]


async def loaded(db: AsyncSession, w: SubWorld) -> None:
    (await get_row(db, Trip, w.trip_id)).trip_type = TripType.LOADED.value
    await db.flush()


# ── handover uploads ─────────────────────────────────────────────────────────


async def test_a_pending_incoming_driver_can_upload_takeover_evidence(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)

    read = await handover_upload(db_session, w, pending, w.b, SubstitutionRole.INCOMING)

    artifact = await get_row(db_session, EvidenceArtifact, read.id)
    assert artifact.captured_by_driver_id == w.b
    assert (artifact.phase_event_id, artifact.evidence_role) == (None, None)
    [row] = await uploads(db_session)
    assert (row.artifact_id, row.driver_id, row.purpose, row.request_id, row.role) == (
        read.id, w.b, "handover", pending.id, "incoming",
    )
    # An upload is not a confirmation.
    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).version == pending.version


@pytest.mark.parametrize("who", ["third_driver", "other_organisation"])
async def test_a_driver_not_named_on_the_request_is_not_found(db_session: AsyncSession, storage: list[bytes], who: str):
    w, pending = await armed(db_session)
    stranger = w.c if who == "third_driver" else w.d

    with pytest.raises(ResourceNotFoundError):
        await handover_upload(db_session, w, pending, stranger, SubstitutionRole.INCOMING)

    assert storage == [] and await uploads(db_session) == []


async def test_claiming_the_other_drivers_role_is_refused(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)

    with pytest.raises(SubstitutionInvalidError):
        await handover_upload(db_session, w, pending, w.b, SubstitutionRole.OUTGOING)

    assert storage == []


async def test_an_exact_retry_returns_the_same_artifact_without_a_second_upload(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)
    body = upload()
    first = await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING, body)

    again = await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING, body)

    assert again == first and len(storage) == 1 and len(await uploads(db_session)) == 1


async def test_the_same_key_with_different_bytes_is_refused(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)
    key = uuid.uuid4()
    await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING, upload(key=key))

    with pytest.raises(IdempotencyKeyReusedError):
        await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING, upload(key=key))


async def test_the_other_drivers_identical_file_is_not_a_second_capture(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)
    same = jpeg()
    await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING, upload(same))

    with pytest.raises(SubstitutionInvalidError):
        await handover_upload(db_session, w, pending, w.b, SubstitutionRole.INCOMING, upload(same))

    assert len(await uploads(db_session)) == 1


async def test_uploading_for_a_cancelled_request_is_refused_and_earlier_uploads_are_kept(
    db_session: AsyncSession, storage: list[bytes],
):
    w, pending = await armed(db_session)
    kept = await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING)
    await cancel_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
        payload=CancelSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=1, reason="Plans changed"),
    )

    with pytest.raises(SubstitutionNotPendingError):
        await handover_upload(db_session, w, pending, w.b, SubstitutionRole.INCOMING)

    assert [row.artifact_id for row in await uploads(db_session)] == [kept.id]
    assert await db_session.get(EvidenceArtifact, kept.id) is not None


async def test_uploading_after_the_role_is_confirmed_is_stale(db_session: AsyncSession, storage: list[bytes]):
    w, pending = await armed(db_session)
    first = await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.a),
        payload=capture(w, 1),
    )

    with pytest.raises(SubstitutionVersionChangedError):
        await handover_upload(db_session, w, first, w.a, SubstitutionRole.OUTGOING)


async def test_a_confirmation_may_cite_only_the_drivers_own_upload_for_this_handover(
    db_session: AsyncSession, storage: list[bytes],
):
    w, pending = await armed(db_session)
    await loaded(db_session, w)
    outgoing_photo = await handover_upload(db_session, w, pending, w.a, SubstitutionRole.OUTGOING)
    incoming_photo = await handover_upload(db_session, w, pending, w.b, SubstitutionRole.INCOMING)
    # B's ordinary trip photo (not a handover upload) does not count either.
    plain = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=w.trip_id, artifact_type=ArtifactType.PHOTO.value, s3_key="k", s3_bucket="b",
        file_hash=hashlib.sha256(jpeg()).hexdigest(), mime_type="image/jpeg", captured_by_driver_id=w.b,
        captured_at=NOW,
    )
    db_session.add(plain)
    await db_session.flush()
    first = await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.a),
        payload=capture(w, 1, seal_checks=seal_with(w, outgoing_photo.id)),
    )
    incoming = await driver_actor(db_session, w.b)

    for cited in (outgoing_photo.id, plain.id):
        with pytest.raises(SubstitutionInvalidError):
            await confirm_substitution(
                db_session, trip_id=w.trip_id, request_id=pending.id, actor=incoming,
                payload=capture(w, first.version, seal_checks=seal_with(w, cited)),
            )
    await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=incoming,
        payload=capture(w, first.version, seal_checks=seal_with(w, incoming_photo.id)),
    )

    cited_ids = set((await db_session.execute(select(DriverSubstitutionConfirmationArtifact.artifact_id))).scalars())
    assert cited_ids == {outgoing_photo.id, incoming_photo.id}


# ── phase deduplication after a takeover ─────────────────────────────────────


async def test_the_new_driver_cannot_inherit_the_previous_drivers_identical_phase_photo(
    db_session: AsyncSession, storage: list[bytes],
):
    w = await build_world(db_session)
    same = jpeg()
    attribution = EvidenceAttribution(phase_event_id=w.confirmation_id, role=EvidenceRole.POD_PHOTO)
    a_photo = await create_artifact(
        db_session, trip_id=w.trip_id, file_bytes=same, mime_type="image/jpeg", artifact_type=ArtifactType.PHOTO,
        captured_at=NOW, captured_by_driver_id=w.a, attribution=attribution, custody_sequence=0,
    )
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)

    with pytest.raises(EvidenceAttributionError):
        await create_artifact(
            db_session, trip_id=w.trip_id, file_bytes=same, mime_type="image/jpeg", artifact_type=ArtifactType.PHOTO,
            captured_at=NOW, captured_by_driver_id=w.b, attribution=attribution, custody_sequence=1,
        )

    assert (await get_row(db_session, EvidenceArtifact, a_photo.id)).captured_by_driver_id == w.a


# ── late uploads ─────────────────────────────────────────────────────────────


async def late_upload(db: AsyncSession, w: SubWorld, driver_id: uuid.UUID, sequence: int, body: ValidatedArtifactUpload | None = None):
    return await create_late_evidence_artifact(
        db, trip_id=w.trip_id, driver=await driver_actor(db, driver_id), custody_sequence=sequence,
        upload=body or upload(),
    )


async def test_a_former_driver_can_upload_late_evidence_for_their_own_period(db_session: AsyncSession, storage: list[bytes]):
    w = await build_world(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)

    read = await late_upload(db_session, w, w.a, 0)

    [row] = await uploads(db_session)
    assert (row.artifact_id, row.purpose, row.custody_sequence, row.request_id) == (read.id, "late_evidence", 0, None)


async def test_late_upload_rules(db_session: AsyncSession, storage: list[bytes]):
    w = await build_world(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)

    with pytest.raises(SubstitutionInvalidError):  # A never held period 1
        await late_upload(db_session, w, w.a, 1)
    with pytest.raises(SubstitutionInvalidError):  # B's period 1 is current: use the live route
        await late_upload(db_session, w, w.b, 1)
    with pytest.raises(ResourceNotFoundError):  # C never held the trip
        await late_upload(db_session, w, w.c, 0)

    assert await uploads(db_session) == []


async def test_a_returning_driver_can_still_submit_late_evidence_for_their_first_period(
    db_session: AsyncSession, storage: list[bytes],
):
    w = await build_world(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    await complete_handover(db_session, w, outgoing=w.b, incoming=w.a)

    await late_upload(db_session, w, w.a, 0)
    with pytest.raises(SubstitutionInvalidError):
        await late_upload(db_session, w, w.a, 2)

    assert (await db_session.execute(select(func.count()).select_from(DriverSubstitutionUpload))).scalar_one() == 1


async def test_a_late_upload_retry_is_answered_from_the_first(db_session: AsyncSession, storage: list[bytes]):
    w = await build_world(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    body = upload(at=datetime.now(UTC))

    first = await late_upload(db_session, w, w.a, 0, body)
    again = await late_upload(db_session, w, w.a, 0, body)

    assert again == first and len(storage) == 1
