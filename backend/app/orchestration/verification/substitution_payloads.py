"""Rebuild a driver substitution's (or correction's) commitment from the live rows (FP-83 C5).

Never from the row's stored payload_json, which is the thing being checked. The same loader
feeds freezing at completion, the anchor worker's pre-publish check, verification and the
custody-chain integrity read, so all four judge the same facts.

`live_file_hashes` swaps each photo's recorded hash for the hash of its bytes in Storage now
(verification), so an edited stored object is a mismatch rather than a silent pass.
"""

import uuid
from dataclasses import dataclass
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionCorrection,
    DriverSubstitutionRequest,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.trips import DriverSubstitution
from app.orchestration.substitutions import canonical


def completed_metadata_findings(row: DriverSubstitution, request: DriverSubstitutionRequest) -> list[str]:
    """Mirrored exported facts must agree with the authoritative committed request."""
    pairs = {
        "request": (row.request_id, request.id), "trip": (row.trip_id, request.trip_id),
        "outgoing driver": (row.original_driver_id, request.outgoing_driver_id),
        "incoming driver": (row.substituting_driver_id, request.incoming_driver_id),
        "arranger": (row.approving_dispatcher_user_id, request.arranged_by_user_id),
        "planned flag": (row.is_planned, request.is_planned),
        "exchange label": (row.exchange_location, request.exchange_label),
    }
    return [f"Completed {name} differs from its request." for name, (actual, expected) in pairs.items() if actual != expected]


@dataclass(frozen=True)
class ReceiptBinding:
    receipt_id: uuid.UUID | None
    subject_id: uuid.UUID
    subject_type: str
    receipt_type: str
    trip_id: uuid.UUID
    event_hash: str | None


def receipt_binding_findings(receipt: BlockchainReceipt | None, binding: ReceiptBinding) -> list[str]:
    if binding.receipt_id is None:
        return []  # not anchored yet; the caller reports PENDING
    if receipt is None:
        return ["Linked custody receipt is missing."]
    if (receipt.id != binding.receipt_id or receipt.subject_id != binding.subject_id or receipt.subject_type != binding.subject_type
            or receipt.receipt_type != binding.receipt_type or receipt.trip_id != binding.trip_id
            or receipt.data_hash != binding.event_hash or not isinstance(receipt.payload_json, dict)
            or canonical.canonical_hash(receipt.payload_json) != binding.event_hash):
        return ["Linked custody receipt does not match its subject, trip, kind or commitment."]
    return []


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
            location_observed_at=row.location_observed_at, location_unavailable_reason=row.location_unavailable_reason,
        ))
    return tuple(captures), artifacts


def _exchange_commitment(request: DriverSubstitutionRequest) -> str | None:
    if request.request_format != "planned_v1":
        return None
    if request.exchange_label is None or request.exchange_latitude is None or request.exchange_longitude is None:
        raise canonical.UnsupportedPayload("Legacy request has incomplete exchange metadata")
    return canonical.exchange_hash(label=request.exchange_label, latitude=request.exchange_latitude,
        longitude=request.exchange_longitude, instructions=request.exchange_instructions)


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
        exchange_sha256=_exchange_commitment(request),
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
        request_format=request.request_format, reservation_start_at=request.reservation_start_at,
    )
    return record, artifacts


async def rebuild_substitution_payload(
    db: AsyncSession, substitution_id: uuid.UUID, *, live_file_hashes: Mapping[uuid.UUID, str] | None = None,
    payload_version: int | None = None,
) -> dict[str, object] | None:
    row = await db.get(DriverSubstitution, substitution_id)
    request = await db.get(DriverSubstitutionRequest, row.request_id) if row is not None and row.request_id else None
    if row is not None and request is not None and completed_metadata_findings(row, request):
        return None
    if row is None or request is None:
        return None
    version = row.payload_version if row.payload_version is not None else (1 if request.request_format == "planned_v1" else 2)
    if payload_version is not None and payload_version != version:
        raise canonical.UnsupportedPayload("Receipt and frozen row payload versions differ")
    if version not in (1, 2) or version != (1 if request.request_format == "planned_v1" else 2):
        raise canonical.UnsupportedPayload("Request and frozen payload versions differ")
    loaded = await load_substitution_record(db, substitution_id, live_file_hashes=live_file_hashes)
    return None if loaded is None else canonical.compute_substitution_payload(record=loaded[0], payload_version=version)


async def rebuild_correction_payload(db: AsyncSession, correction_id: uuid.UUID) -> dict[str, object] | None:
    row = (await db.execute(
        select(DriverSubstitutionCorrection, DriverSubstitution.trip_id)
        .join(DriverSubstitution, DriverSubstitution.id == DriverSubstitutionCorrection.substitution_id)
        .where(DriverSubstitutionCorrection.id == correction_id)
    )).one_or_none()
    if row is None:
        return None
    correction, trip_id = row
    if correction.payload_version != canonical.CORRECTION_PAYLOAD_VERSION:
        raise canonical.UnsupportedPayload('Unknown driver substitution correction payload version')
    canonical.validate_correction_payload(correction.payload_json)
    return canonical.compute_correction_payload(record=canonical.CorrectionRecord(
        correction_id=correction.id, substitution_id=correction.substitution_id, trip_id=trip_id,
        recorded_by_user_id=correction.recorded_by_user_id, recorded_at=correction.created_at,
        reason=correction.reason, correction_note=correction.correction_note,
    ))
