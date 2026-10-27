"""Evidence artifact creation — uploads to Storage, records the DB row."""

import hashlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import EvidenceAttributionError, ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.evidence import EvidenceArtifact
from app.db.models.enums import ArtifactType
from app.db.models.trips import Trip
from app.orchestration.substitutions.access import WriteClaim, authorise_driver_write
from app.orchestration.evidence.attribution import EvidenceAttribution, validate_driver_attribution
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.schemas.evidence import EvidenceArtifactRead, EvidenceArtifactWithUrl
from app.storage.mime_allowlist import resolve_mime_type
from app.storage.supabase_storage import (
    MAX_EVIDENCE_FILE_SIZE_BYTES,
    create_signed_url,
    upload_evidence_file,
)

logger = logging.getLogger(__name__)

MAX_FILE_SIZE_BYTES = MAX_EVIDENCE_FILE_SIZE_BYTES

_DEDUP_INDEX = "uq_evidence_artifacts_phase_role_hash"


async def create_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
    attribution: EvidenceAttribution | None = None,
    custody_sequence: int | None = None,
) -> EvidenceArtifactRead:
    """Raises ResourceNotFoundError if the trip (or the attributed phase) doesn't exist on it or
    captured_by_driver_id never held it, a CustodyAccessError (mapped to 409 with the contract's
    code) if they held it earlier or the capture belongs to another custody period, and
    EvidenceAttributionError if the role is not one this phase takes from a driver.

    `mime_type` arrives as the CLIENT'S claim about the file. It is not trusted and not
    stored — resolve_mime_type re-derives the type from the bytes and that is what lands
    on the record and on the Storage object. See app/storage/mime_allowlist.py.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    verified_mime_type = resolve_mime_type(file_bytes, mime_type)

    async def authorise(*, lock: bool) -> Trip:
        trip, _ = await authorise_driver_write(
            db, trip_id=trip_id, driver_id=captured_by_driver_id,
            claim=WriteClaim(custody_sequence, lambda: _find_own_upload(
                db, trip_id=trip_id, driver_id=captured_by_driver_id, attribution=attribution,
                file_hash=hashlib.sha256(file_bytes).hexdigest(),
            )),
            lock=lock,
        )
        return trip

    trip = await authorise(lock=False)
    if attribution is not None:
        await validate_driver_attribution(db, trip_id=trip_id, attribution=attribution)

    return await _persist_artifact(
        db,
        trip=trip,
        file_bytes=file_bytes,
        verified_mime_type=verified_mime_type,
        artifact_type=artifact_type,
        captured_at=captured_at,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        attribution=attribution,
        recheck=lambda: authorise(lock=True),
    )


async def _find_own_upload(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, attribution: EvidenceAttribution | None,
    file_hash: str,
) -> uuid.UUID | None:
    """This driver's own earlier upload of the same bytes to the same phase and role - the proof
    that a post-handover retry is theirs. Only attributed uploads: they are the ones the
    persist step already de-duplicates, so a match here is answered from the stored row. A
    plain unattributed photo has no replay semantics, so it is never treated as a retry (that
    would let a stale capture through under a "replay" label). Matches on the stored capturer,
    so another driver's identical photo is never acknowledged for the caller."""
    if attribution is None:
        return None
    return (await db.execute(
        select(EvidenceArtifact.id).where(
            EvidenceArtifact.trip_id == trip_id, EvidenceArtifact.captured_by_driver_id == driver_id,
            EvidenceArtifact.file_hash == file_hash,
            EvidenceArtifact.phase_event_id == attribution.phase_event_id,
            EvidenceArtifact.evidence_role == attribution.role,
        ).limit(1)
    )).scalar_one_or_none()


async def _persist_artifact(
    db: AsyncSession,
    *,
    trip: Trip,
    file_bytes: bytes,
    verified_mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID | None,
    captured_lat: Decimal | None,
    captured_lng: Decimal | None,
    attribution: EvidenceAttribution | None,
    recheck: Callable[[], Awaitable[object]] | None = None,
) -> EvidenceArtifactRead:
    """Upload the bytes and write the row.

    `recheck`, when given, runs after the upload and before the insert: the driver path
    re-authorises under the trip lock there (see create_artifact).

    Assumes the caller has already decided the upload is authorised. That decision
    differs per caller — the assigned driver for create_artifact, a redeemed capability
    token for create_receiver_artifact — and deliberately does not live here, so neither
    check can be skipped by routing around this function.

    An attributed upload whose bytes already exist for the same phase and role returns the
    stored row untouched (no Storage object, no row, no event). The hash is taken from the
    bytes before the upload so a repeat costs nothing.
    """
    if attribution is not None:
        existing = await _find_attributed_duplicate(
            db, attribution=attribution, file_hash=hashlib.sha256(file_bytes).hexdigest(),
        )
        if existing is not None:
            return _duplicate_result(existing, captured_at, captured_by_driver_id=captured_by_driver_id)

    upload = await upload_evidence_file(
        trip_id=str(trip.id), file_bytes=file_bytes, mime_type=verified_mime_type,
    )
    if recheck is not None:
        await recheck()

    artifact = EvidenceArtifact(
        id=uuid.uuid4(),
        trip_id=trip.id,
        artifact_type=artifact_type,
        s3_key=upload.s3_key,
        s3_bucket=upload.s3_bucket,
        file_hash=upload.file_hash,
        mime_type=verified_mime_type,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        captured_at=captured_at,
        created_at=datetime.now(UTC),
        phase_event_id=attribution.phase_event_id if attribution else None,
        evidence_role=attribution.role if attribution else None,
    )
    if attribution is None:
        db.add(artifact)
        await db.flush()
    else:
        winner = await _insert_attributed(db, artifact, attribution)
        if winner is not None:
            logger.warning(
                "Storage object %s/%s orphaned: lost the deduplication race to artifact %s",
                upload.s3_bucket, upload.s3_key, winner.id,
            )
            return _duplicate_result(winner, captured_at, captured_by_driver_id=captured_by_driver_id)

    await db.refresh(artifact)
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(id=trip.id, kind=RealtimeKind.EVIDENCE_UPLOADED),
    )
    return EvidenceArtifactRead.model_validate(artifact)


async def _find_attributed_duplicate(
    db: AsyncSession, *, attribution: EvidenceAttribution, file_hash: str,
) -> EvidenceArtifact | None:
    return (
        await db.execute(
            select(EvidenceArtifact).where(
                EvidenceArtifact.phase_event_id == attribution.phase_event_id,
                EvidenceArtifact.evidence_role == attribution.role,
                EvidenceArtifact.file_hash == file_hash,
            )
        )
    ).scalar_one_or_none()


async def _insert_attributed(
    db: AsyncSession, artifact: EvidenceArtifact, attribution: EvidenceAttribution,
) -> EvidenceArtifact | None:
    """Insert, or return the row that won a concurrent identical upload (None = inserted).

    The savepoint keeps a lost race from poisoning the caller's transaction. Any other
    integrity failure is a real error and propagates.
    """
    try:
        async with db.begin_nested():
            db.add(artifact)
            await db.flush()
    except IntegrityError as exc:
        if not is_unique_violation(exc) or violated_constraint(exc) != _DEDUP_INDEX:
            raise
        winner = await _find_attributed_duplicate(
            db, attribution=attribution, file_hash=artifact.file_hash,
        )
        if winner is None:
            raise
        return winner
    return None


def _duplicate_result(
    existing: EvidenceArtifact, incoming_captured_at: datetime, *, captured_by_driver_id: uuid.UUID | None,
) -> EvidenceArtifactRead:
    """The stored row, exactly as it was. A differing capture time is logged, never written:
    the original record is the evidence, and the mismatch points at a client defect.

    Only ever the caller's OWN row (FP-83 C4): after a handover the same bytes for the same phase
    and role may already be the previous driver's capture, and answering with that row would let
    the new driver cite it as theirs. The index allows one row per bytes, so the upload is refused.
    """
    if captured_by_driver_id is not None and existing.captured_by_driver_id != captured_by_driver_id:
        raise EvidenceAttributionError(
            "This exact photo is already recorded for this step by another driver; take your own photo."
        )
    if existing.captured_at != incoming_captured_at:
        logger.warning(
            "Identical upload for artifact %s arrived with captured_at %s; keeping stored %s",
            existing.id, incoming_captured_at.isoformat(), existing.captured_at.isoformat(),
        )
    else:
        logger.info("Identical upload returned existing artifact %s", existing.id)
    return EvidenceArtifactRead.model_validate(existing)


async def create_receiver_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
    attribution: EvidenceAttribution | None = None,
) -> EvidenceArtifactRead:
    """Store an artifact produced by a receiver holding a redeemed capability token.

    Deliberately NOT create_artifact with a nullable driver id. That function's
    `trip.driver_id != captured_by_driver_id` check is its reason to exist, and making it
    skippable would put an `if caller_is_trusted` branch inside the one place that decides
    whether an upload belongs to its trip. The authorisation here is a different thing
    entirely — a single-use capability token the caller has already redeemed — and it
    belongs to the caller, not to this function.

    Both capturer columns (driver and user) are left NULL, which is the honest record:
    nobody with an account on this system captured this. The evidence that it came from the
    receiver is the HandoverConfirmation row referencing it, not a column here pointing at a
    driver who was standing on the other side of the transaction. `attribution` is the phase
    and role the caller derived from the redeemed token; it is never taken from the receiver.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    verified_mime_type = resolve_mime_type(file_bytes, mime_type)

    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    return await _persist_artifact(
        db,
        trip=trip,
        file_bytes=file_bytes,
        verified_mime_type=verified_mime_type,
        artifact_type=artifact_type,
        captured_at=captured_at,
        captured_by_driver_id=None,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        attribution=attribution,
    )


async def list_artifacts_for_trip(
    db: AsyncSession, trip_id: uuid.UUID, *, operator_organization_id: uuid.UUID,
) -> list[EvidenceArtifactWithUrl]:
    """Every artifact on one trip, each with a freshly minted signed URL.

    Tenancy is enforced in the trip lookup, mirroring get_manifest_for_dispatcher: a trip
    belonging to another operator is indistinguishable from one that does not exist.
    """
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )
    if trip_result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    artifacts_result = await db.execute(
        select(EvidenceArtifact)
        .where(EvidenceArtifact.trip_id == trip_id)
        .order_by(EvidenceArtifact.captured_at)
    )

    out: list[EvidenceArtifactWithUrl] = []
    for artifact in artifacts_result.scalars().all():
        signed_url = await create_signed_url(
            s3_bucket=artifact.s3_bucket,
            s3_key=artifact.s3_key,
            ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
        )
        out.append(
            EvidenceArtifactWithUrl.model_validate(artifact).model_copy(
                update={"signed_url": signed_url}
            )
        )
    return out


async def get_trip_scoped_artifact(
    db: AsyncSession, *, artifact_id: uuid.UUID, trip_id: uuid.UUID,
) -> EvidenceArtifactWithUrl | None:
    """Resolve and sign exactly one artifact, scoped to the trip it must belong to.

    An artifact id that exists but belongs to a different trip is indistinguishable
    from one that does not exist at all (the ownership invariant) — callers must
    never trust a stored artifact id without this check, even one this same codebase
    wrote. Returns None only when no such artifact is scoped to this trip; a found
    artifact is always returned, with signed_url left None if Storage declines to sign
    it (the artifact is still evidence even when its image can't be fetched right now).
    """
    result = await db.execute(
        select(EvidenceArtifact).where(
            EvidenceArtifact.id == artifact_id, EvidenceArtifact.trip_id == trip_id,
        )
    )
    artifact = result.scalar_one_or_none()
    if artifact is None:
        return None

    signed_url = await create_signed_url(
        s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key,
        ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
    )
    return EvidenceArtifactWithUrl.model_validate(artifact).model_copy(
        update={"signed_url": signed_url}
    )


async def sign_artifact_url(artifact: EvidenceArtifact) -> str | None:
    """A short-lived read URL for an artifact the caller has already scoped to its trip.

    None when Storage declines to sign (the artifact is still evidence). Callers must have
    established ownership first; this does not check it.
    """
    return await create_signed_url(
        s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key,
        ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
    )
