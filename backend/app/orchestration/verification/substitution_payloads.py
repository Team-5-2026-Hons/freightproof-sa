"""Rebuild a driver substitution's (or correction's) commitment from the live rows (FP-83 C5).

Never from the row's stored payload_json, which is the thing being checked. The same loader
feeds freezing at completion, the anchor worker's pre-publish check, verification and the
custody-chain integrity read, so all four judge the same facts.

`live_file_hashes` swaps each photo's recorded hash for the hash of its bytes in Storage now
(verification), so an edited stored object is a mismatch rather than a silent pass.
"""

import uuid
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionCorrection,
    DriverSubstitutionRequest,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import DriverSubstitution
from app.orchestration.substitutions import canonical


async def _photos(
    db: AsyncSession, confirmation_id: uuid.UUID, live_file_hashes: Mapping[uuid.UUID, str] | None,
) -> tuple[tuple[canonical.PhotoCommitment, ...], list[EvidenceArtifact]]:
    rows = (await db.execute(
        select(DriverSubstitutionConfirmationArtifact, EvidenceArtifact)
        .join(EvidenceArtifact, EvidenceArtifact.id == DriverSubstitutionConfirmationArtifact.artifact_id)
        .where(DriverSubstitutionConfirmationArtifact.confirmation_id == confirmation_id)
        .order_by(DriverSubstitutionConfirmationArtifact.position)
    )).all()
    photos = tuple(
        canonical.PhotoCommitment(
            artifact_id=artifact.id, vehicle_id=link.vehicle_id, position=link.position,
            file_sha256=(live_file_hashes or {}).get(artifact.id, artifact.file_hash),
        )
        for link, artifact in rows
    )
    return photos, [artifact for _, artifact in rows]


async def _captures(
    db: AsyncSession, request_id: uuid.UUID, live_file_hashes: Mapping[uuid.UUID, str] | None,
) -> tuple[tuple[canonical.CaptureCommitment, ...], list[EvidenceArtifact]]:
    confirmations = (await db.execute(
        select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id == request_id)
        .order_by(DriverSubstitutionConfirmation.role)
    )).scalars().all()
    captures: list[canonical.CaptureCommitment] = []
    artifacts: list[EvidenceArtifact] = []
    for row in confirmations:
        photos, stored = await _photos(db, row.id, live_file_hashes)
        artifacts.extend(stored)
        captures.append(canonical.CaptureCommitment(
            role=row.role, confirmation_id=row.id, driver_id=row.driver_id, captured_at=row.captured_at,
            received_at=row.received_at,
            location_sha256=canonical.location_hash(row.latitude, row.longitude, row.accuracy_metres),
            vehicles_sha256=canonical.vehicles_hash(row.confirmed_vehicle_ids),
            seal_checks_sha256=canonical.seal_checks_hash(row.seal_checks),
            note_sha256=canonical.text_hash_or_none(row.discrepancy_note), photos=photos,
        ))
    return tuple(captures), artifacts


async def load_substitution_record(
    db: AsyncSession, substitution_id: uuid.UUID, *, live_file_hashes: Mapping[uuid.UUID, str] | None = None,
) -> tuple[canonical.CompletedSubstitutionRecord, list[EvidenceArtifact]] | None:
    """The record and the photos it commits to, or None for a missing or legacy (request-less)
    row: a legacy amendment has no recorded request or captures, and none is fabricated."""
    row = await db.get(DriverSubstitution, substitution_id)
    if row is None or row.request_id is None:
        return None
    request = await db.get(DriverSubstitutionRequest, row.request_id)
    if request is None:
        return None
    previous_hash = None
    if row.previous_substitution_id is not None:
        previous_hash = (await db.execute(
            select(DriverSubstitution.event_hash).where(DriverSubstitution.id == row.previous_substitution_id)
        )).scalar_one_or_none()
    captures, artifacts = await _captures(db, request.id, live_file_hashes)
    record = canonical.CompletedSubstitutionRecord(
        substitution_id=row.id, trip_id=row.trip_id, request_id=request.id, sequence_number=row.sequence_number,
        previous_substitution_id=row.previous_substitution_id, previous_event_hash=previous_hash,
        outgoing_driver_id=row.original_driver_id, incoming_driver_id=row.substituting_driver_id,
        arranged_by_user_id=request.arranged_by_user_id, is_planned=request.is_planned,
        reason_sha256=canonical.sha256_text(request.reason),
        exchange_sha256=canonical.exchange_hash(
            label=request.exchange_label, latitude=request.exchange_latitude, longitude=request.exchange_longitude,
            instructions=request.exchange_instructions,
        ),
        expected_at=request.expected_at, effective_at=row.substitution_at,
        declared_exchange_at=row.declared_exchange_at, completion_mode=row.completion_mode,
        completed_by_driver_id=row.completed_by_driver_id, completed_by_user_id=row.completed_by_user_id,
        missing_confirmation_reason_sha256=canonical.text_hash_or_none(row.missing_confirmation_reason),
        identity=canonical.IdentityCommitment(
            status=row.incoming_identity_status, last_verified_at=row.incoming_identity_last_verified_at,
            observed_at=row.incoming_identity_observed_at, attested_by_user_id=row.identity_attested_by_user_id,
            attestation_reason_sha256=canonical.text_hash_or_none(row.identity_attestation_reason),
            attested_at=row.identity_attested_at,
        ),
        licence_expiry=row.incoming_licence_expiry, eligibility_observed_at=row.eligibility_observed_at,
        captures=captures,
    )
    return record, artifacts


async def rebuild_substitution_payload(
    db: AsyncSession, substitution_id: uuid.UUID, *, live_file_hashes: Mapping[uuid.UUID, str] | None = None,
) -> dict[str, object] | None:
    loaded = await load_substitution_record(db, substitution_id, live_file_hashes=live_file_hashes)
    return None if loaded is None else canonical.compute_substitution_payload(record=loaded[0])


async def rebuild_correction_payload(db: AsyncSession, correction_id: uuid.UUID) -> dict[str, object] | None:
    row = (await db.execute(
        select(DriverSubstitutionCorrection, DriverSubstitution.trip_id)
        .join(DriverSubstitution, DriverSubstitution.id == DriverSubstitutionCorrection.substitution_id)
        .where(DriverSubstitutionCorrection.id == correction_id)
    )).one_or_none()
    if row is None:
        return None
    correction, trip_id = row
    return canonical.compute_correction_payload(record=canonical.CorrectionRecord(
        correction_id=correction.id, substitution_id=correction.substitution_id, trip_id=trip_id,
        recorded_by_user_id=correction.recorded_by_user_id, recorded_at=correction.created_at,
        reason=correction.reason, correction_note=correction.correction_note,
    ))
