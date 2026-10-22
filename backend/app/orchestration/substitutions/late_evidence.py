"""Evidence a driver captured in an earlier custody period of theirs, retained for review (FP-83 C4).

A former driver's queued work cannot go through the live routes (they answer TRIP_HANDED_OVER
or CUSTODY_CONTEXT_CHANGED), and must not be lost. It is kept here instead, verbatim:

- The typed payload is one of the four existing live-write request schemas, stored as sent with
  a SHA-256 commitment over its canonical JSON. It is never executed: retaining it calls no phase,
  checkpoint, location or exception service, so it cannot advance a phase, move custody or land
  in an earlier place in the ledger.
- The claimed custody period is checked against the completed handover chain: the caller must
  have held it and must no longer hold it. The phone's capture time is kept as a claim beside
  the server's receipt time and authorises nothing.
- Attached photos must be the caller's own late uploads for that same period, each used once.

A dispatcher's acknowledgement records that someone reviewed it, and changes nothing else.
"""

import hashlib
import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError, SubstitutionInvalidError, SubstitutionVersionChangedError
from app.core.realtime import EventSeverity, RealtimeKind, TripEvent, enqueue_event
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import DriverSubstitution, Trip
from app.db.models.driver_substitutions import (
    DriverSubstitutionUpload, LateDriverEvidence, LateDriverEvidenceArtifact,
)
from app.orchestration.substitutions.access import lock_trip
from app.orchestration.substitutions.artifacts import PURPOSE_LATE, require_former_period, require_participant
from app.orchestration.substitutions import operations
from app.orchestration.substitutions.guards import lock_org_trip
from app.orchestration.substitutions.operations import (
    OperationKey,
    body_digest,
    find_replay,
    record_operation,
)
from app.schemas.driver_substitutions import (
    AcknowledgeLateEvidenceRequest, LateEvidenceRead, LateEvidenceRequest, LateEvidenceStatus,
)
from app.schemas.people import DriverRead, UserRead

ACTION_LATE_EVIDENCE = "late_evidence"
ACTION_ACKNOWLEDGE = "acknowledge_late_evidence"


async def _ordinary_attachments(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, custody_sequence: int,
    artifact_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """Server upload times must lie strictly inside the claimed period; device time proves none."""
    trip = await db.get(Trip, trip_id)
    boundaries = {sequence: moment for sequence, moment in (await db.execute(select(
        DriverSubstitution.sequence_number, DriverSubstitution.substitution_at,
    ).where(DriverSubstitution.trip_id == trip_id))).all()}
    start = trip.created_at if trip is not None and custody_sequence == 0 else boundaries.get(custody_sequence)
    end = boundaries.get(custody_sequence + 1)
    if start is None or end is None or start >= end:
        return set()
    return set((await db.execute(select(EvidenceArtifact.id).where(
        EvidenceArtifact.id.in_(artifact_ids), EvidenceArtifact.trip_id == trip_id,
        EvidenceArtifact.captured_by_driver_id == driver_id,
        EvidenceArtifact.created_at > start, EvidenceArtifact.created_at < end,
        ~select(DriverSubstitutionUpload.artifact_id).where(
            DriverSubstitutionUpload.artifact_id == EvidenceArtifact.id,
        ).exists(),
    ))).scalars())


def _notify_late_evidence(db: AsyncSession, trip: Trip) -> None:
    enqueue_event(db, trip.operator_organization_id, TripEvent(
        id=trip.id, kind=RealtimeKind.LATE_DRIVER_EVIDENCE_CHANGED, severity=EventSeverity.INFO,
    ))


def payload_sha256(evidence_json: object) -> str:
    """The commitment over the retained payload: canonical JSON (sorted keys, no whitespace), so
    the same evidence always hashes the same and any later edit of the stored JSON is visible."""
    canonical = json.dumps(evidence_json, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


async def _artifact_ids(db: AsyncSession, evidence_id: uuid.UUID) -> list[uuid.UUID]:
    return list((await db.execute(
        select(LateDriverEvidenceArtifact.artifact_id)
        .where(LateDriverEvidenceArtifact.late_evidence_id == evidence_id)
        .order_by(LateDriverEvidenceArtifact.position)
    )).scalars())


async def build_late_evidence_read(db: AsyncSession, row: LateDriverEvidence) -> LateEvidenceRead:
    return LateEvidenceRead(
        id=row.id, trip_id=row.trip_id, driver_id=row.driver_id, custody_sequence=row.custody_sequence,
        captured_at=row.captured_at, received_at=row.received_at, status=LateEvidenceStatus(row.status),
        artifact_ids=await _artifact_ids(db, row.id), reviewed_by_user_id=row.reviewed_by_user_id,
        reviewed_at=row.reviewed_at, review_note=row.review_note,
    )


async def _check_attachments(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, custody_sequence: int, artifact_ids: list[uuid.UUID],
) -> None:
    """Every attachment is the caller's own late upload for this period, not yet used elsewhere."""
    if len(set(artifact_ids)) != len(artifact_ids):
        raise SubstitutionInvalidError("A photo can be attached only once.")
    if not artifact_ids:
        return
    own = set((await db.execute(select(DriverSubstitutionUpload.artifact_id).where(
        DriverSubstitutionUpload.artifact_id.in_(artifact_ids), DriverSubstitutionUpload.trip_id == trip_id,
        DriverSubstitutionUpload.driver_id == driver_id, DriverSubstitutionUpload.purpose == PURPOSE_LATE,
        DriverSubstitutionUpload.custody_sequence == custody_sequence,
    ))).scalars())
    own.update(await _ordinary_attachments(
        db, trip_id=trip_id, driver_id=driver_id, custody_sequence=custody_sequence, artifact_ids=artifact_ids,
    ))
    used = (await db.execute(select(LateDriverEvidenceArtifact.artifact_id).where(
        LateDriverEvidenceArtifact.artifact_id.in_(artifact_ids),
    ).limit(1))).first()
    if own != set(artifact_ids) or used is not None:
        raise SubstitutionInvalidError(
            "An attached photo is not your own late upload for that custody period, or is already attached."
        )


async def retain_late_evidence(
    db: AsyncSession, *, trip_id: uuid.UUID, driver: DriverRead, payload: LateEvidenceRequest,
) -> LateEvidenceRead:
    """Keep a former custody period's queued capture as a reviewable receipt. An exact retry
    returns the same receipt; it never becomes a live write."""
    await require_participant(db, trip_id=trip_id, driver_id=driver.id)
    trip = await lock_trip(db, trip_id=trip_id)
    key = OperationKey(
        action=ACTION_LATE_EVIDENCE, client_request_id=payload.client_request_id, actor_driver_id=driver.id,
        digest=body_digest(trip_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=LateEvidenceRead)
    if replay is not None:
        return replay

    await require_former_period(db, trip=trip, driver_id=driver.id, custody_sequence=payload.custody_sequence)
    await _check_attachments(
        db, trip_id=trip.id, driver_id=driver.id, custody_sequence=payload.custody_sequence,
        artifact_ids=payload.artifact_ids,
    )
    evidence_json = payload.evidence.model_dump(mode="json")
    row = LateDriverEvidence(
        id=uuid.uuid4(), trip_id=trip.id, driver_id=driver.id, custody_sequence=payload.custody_sequence,
        kind=payload.evidence.kind.value, evidence_json=evidence_json, payload_sha256=payload_sha256(evidence_json),
        original_idempotency_key=payload.original_idempotency_key, captured_at=payload.captured_at,
        received_at=operations.utcnow(), status=LateEvidenceStatus.AWAITING_REVIEW.value,
    )
    db.add(row)
    await db.flush()
    for position, artifact_id in enumerate(payload.artifact_ids):
        db.add(LateDriverEvidenceArtifact(late_evidence_id=row.id, artifact_id=artifact_id, position=position))
    await db.flush()
    await db.refresh(row)

    result = await build_late_evidence_read(db, row)
    record_operation(db, key, request_id=None, result=result, late_evidence_id=row.id)
    _notify_late_evidence(db, trip)
    await db.flush()
    return result


async def acknowledge_late_evidence(
    db: AsyncSession, *, trip_id: uuid.UUID, evidence_id: uuid.UUID, actor: UserRead,
    payload: AcknowledgeLateEvidenceRequest,
) -> LateEvidenceRead:
    """Record a same-organisation dispatcher's review. Review fields only: the retained evidence,
    its hash, the phase ledger and custody are untouched. Reviewing twice is refused as stale
    (another dispatcher acted since this one loaded it), never silently overwritten."""
    trip = await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    key = OperationKey(
        action=ACTION_ACKNOWLEDGE, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, evidence_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=LateEvidenceRead)
    if replay is not None:
        return replay

    row = (await db.execute(
        select(LateDriverEvidence).where(LateDriverEvidence.id == evidence_id, LateDriverEvidence.trip_id == trip.id)
        .with_for_update(key_share=True)
    )).scalar_one_or_none()
    if row is None:
        raise ResourceNotFoundError("LateDriverEvidence", str(evidence_id))
    if row.status != LateEvidenceStatus.AWAITING_REVIEW.value:
        raise SubstitutionVersionChangedError()

    row.status = LateEvidenceStatus.ACKNOWLEDGED.value
    row.reviewed_by_user_id = actor.id
    row.reviewed_at = operations.utcnow()
    row.review_note = payload.note
    await db.flush()
    await db.refresh(row)
    result = await build_late_evidence_read(db, row)
    record_operation(db, key, request_id=None, result=result, late_evidence_id=row.id)
    _notify_late_evidence(db, trip)
    await db.flush()
    return result
