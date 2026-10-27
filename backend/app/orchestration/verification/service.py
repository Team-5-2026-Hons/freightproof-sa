"""Verify a subject's current DB state against its anchored Hedera record.

Returns one of: verified, db_mismatch, hedera_mismatch, no_receipt, error.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import HederaServiceError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType, VerifyStatus
from app.db.models.trips import DriverSubstitution
from app.db.models.driver_substitutions import DriverSubstitutionCorrection, DriverSubstitutionRequest
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.orchestration.verification.errors import _EvidenceMissing, _UnsupportedPhasePayloadVersion
from app.orchestration.verification.evidence_payloads import (
    EvidencePayloadState,
    hash_payload as _hash_evidence_payload,
    payload_with_live_artifact_hashes as _evidence_payload_with_live_hashes,
    reconstruct_evidence_event,
)
from app.orchestration.verification.fleet_events import (
    _reconstruct_driver_event_payload,
    _reconstruct_precinct_event_payload,
    _reconstruct_vehicle_event_payload,
)
from app.orchestration.verification.phase_payloads import (
    _hash_payload,
    _PhaseEvidenceMissing,
    _PhasePayloadState,
    _payload_with_live_artifact_hashes,
    reconstruct_phase_state,
)
from app.orchestration.substitutions import canonical as substitution_canonical
from app.orchestration.verification.substitution_payloads import (
    load_substitution_record,
    rebuild_correction_payload,
    completed_metadata_findings,
    receipt_binding_findings, ReceiptBinding,
    rebuild_substitution_payload,
)
from app.orchestration.verification.trip_payloads import _reconstruct_trip_payload
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError,
    EvidenceStorageUnavailableError,
    hash_stored_evidence_file,
)


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    receipt: BlockchainReceipt | None = None
    expected_hash: str | None = None
    current_hash: str | None = None
    evidence_verified: bool = False


async def _latest_receipt(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID,
    receipt_id: uuid.UUID | None = None,
) -> BlockchainReceipt | None:
    """The subject's newest receipt, or exactly `receipt_id` when given.

    An exact id is still scoped to the subject: a receipt that belongs to some other subject
    is "no receipt" here, so a frozen reference can never make one record verify as another.
    """
    query = select(BlockchainReceipt).where(
        BlockchainReceipt.subject_type == subject_type,
        BlockchainReceipt.subject_id == subject_id,
    )
    if receipt_id is not None:
        query = query.where(BlockchainReceipt.id == receipt_id)
    result = await db.execute(query.order_by(desc(BlockchainReceipt.created_at)).limit(1))
    return result.scalar_one_or_none()


async def _live_artifact_mismatch(
    phase_state: _PhasePayloadState, receipt: BlockchainReceipt,
) -> VerifyOutcome | None:
    """Re-hash the private Storage bytes behind a phase's artifacts against the receipt.
    None means they still match; otherwise the outcome verify_subject should return."""
    try:
        live_payload = await _payload_with_live_artifact_hashes(phase_state)
    except EvidenceObjectIntegrityError:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
        )
    except EvidenceStorageUnavailableError:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
    live_hash = _hash_payload(live_payload)
    if live_hash != receipt.data_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
            current_hash=live_hash,
        )
    return None


async def _evidence_event_mismatch(
    db: AsyncSession, event_id: uuid.UUID, state: EvidencePayloadState, receipt: BlockchainReceipt,
) -> VerifyOutcome | None:
    """The live rows must rebuild to the hash frozen at the action (not only to the receipt),
    and every photo's stored bytes must still hash to what the payload commits.
    None means both hold; otherwise the outcome verify_subject should return."""
    event = await db.get(EvidenceAnchorEvent, event_id)
    if event is None or _hash_evidence_payload(state.payload) != event.event_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH, receipt=receipt, expected_hash=receipt.data_hash,
        )
    if not state.artifacts:
        return None
    try:
        live_payload = await _evidence_payload_with_live_hashes(state)
    except EvidenceObjectIntegrityError:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH, receipt=receipt, expected_hash=receipt.data_hash,
        )
    except EvidenceStorageUnavailableError:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
    live_hash = _hash_evidence_payload(live_payload)
    if live_hash != receipt.data_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH, receipt=receipt,
            expected_hash=receipt.data_hash, current_hash=live_hash,
        )
    return None


@dataclass(frozen=True)
class _Rebuilt:
    """What a reconstructor hands back: the payload rebuilt from live rows, plus the phase
    event's evidence commitments (None for every other subject type)."""
    payload: dict[str, Any]
    phase_state: _PhasePayloadState | None = None
    evidence_state: EvidencePayloadState | None = None


type _Reconstructor = Callable[
    [AsyncSession, uuid.UUID, BlockchainReceipt], Awaitable[_Rebuilt | None]
]


async def _rebuild_trip(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    payload = await _reconstruct_trip_payload(
        db, subject_id, anchored_payload=receipt.payload_json,
    )
    return None if payload is None else _Rebuilt(payload)


async def _rebuild_vehicle_event(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    payload = await _reconstruct_vehicle_event_payload(
        db, subject_id, anchored_payload=receipt.payload_json,
    )
    return None if payload is None else _Rebuilt(payload)


async def _rebuild_driver_event(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    payload = await _reconstruct_driver_event_payload(db, subject_id)
    return None if payload is None else _Rebuilt(payload)


async def _rebuild_precinct_event(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    payload = await _reconstruct_precinct_event_payload(db, subject_id)
    return None if payload is None else _Rebuilt(payload)


async def _rebuild_phase_event(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt:
    state = await reconstruct_phase_state(
        db, subject_id, anchored_payload=receipt.payload_json,
    )
    return _Rebuilt(state.payload, state)


async def _rebuild_evidence_event(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    if await db.get(EvidenceAnchorEvent, subject_id) is None:
        return None
    state = await reconstruct_evidence_event(
        db, event_id=subject_id, anchored_payload=receipt.payload_json,
    )
    if state.payload["event_type"] != receipt.receipt_type:
        raise _UnsupportedPhasePayloadVersion("receipt type does not match the evidence event")
    return _Rebuilt(state.payload, evidence_state=state)


async def _rebuild_driver_substitution(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    """FP-83 C5: a completed handover rebuilt from its live rows, with every capture photo's hash
    taken from the bytes in Storage now, so an edited object fails like an edited row."""
    row = await db.get(DriverSubstitution, subject_id)
    if row is None:
        return None
    request = await db.get(DriverSubstitutionRequest, row.request_id) if row.request_id else None
    if (receipt_binding_findings(
        receipt, ReceiptBinding( receipt_id=row.blockchain_receipt_id, subject_id=row.id,
        subject_type=SubjectType.DRIVER_SUBSTITUTION.value,
        receipt_type=BlockchainReceiptType.DRIVER_SUBSTITUTION.value, trip_id=row.trip_id, event_hash=row.event_hash,
    )) or (request is not None and completed_metadata_findings(row, request))):
        raise _EvidenceMissing("custody receipt or completed metadata differs")
    try:
        substitution_canonical.validate_substitution_payload(receipt.payload_json)
    except substitution_canonical.UnsupportedPayload as error:
        raise _UnsupportedPhasePayloadVersion(str(error)) from error
    loaded = await load_substitution_record(db, subject_id)
    if loaded is None:
        return None
    try:
        live = {
            artifact.id: await hash_stored_evidence_file(s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key)
            for artifact in loaded[1]
        }
    except EvidenceObjectIntegrityError as error:
        raise _EvidenceMissing("a committed handover photo is gone or altered") from error
    except EvidenceStorageUnavailableError as error:
        raise _UnsupportedPhasePayloadVersion("evidence storage unavailable") from error
    rebuilt = await load_substitution_record(db, subject_id, live_file_hashes=live)
    if rebuilt is None:
        return None
    try:
        payload = await rebuild_substitution_payload(db, subject_id, live_file_hashes=live, payload_version=receipt.payload_json["payload_version"])
    except substitution_canonical.UnsupportedPayload as error:
        raise _EvidenceMissing(str(error)) from error
    return None if payload is None else _Rebuilt(payload)


async def _rebuild_driver_substitution_correction(
    db: AsyncSession, subject_id: uuid.UUID, receipt: BlockchainReceipt,
) -> _Rebuilt | None:
    row = await db.get(DriverSubstitutionCorrection, subject_id)
    parent = await db.get(DriverSubstitution, row.substitution_id) if row else None
    if row is None or parent is None:
        return None
    if receipt_binding_findings(
        receipt, ReceiptBinding( receipt_id=row.receipt_id, subject_id=row.id,
        subject_type=SubjectType.DRIVER_SUBSTITUTION_CORRECTION.value,
        receipt_type=BlockchainReceiptType.DRIVER_SUBSTITUTION_CORRECTED.value, trip_id=parent.trip_id, event_hash=row.event_hash,
    )):
        raise _EvidenceMissing("clarification receipt differs")
    try:
        substitution_canonical.validate_correction_payload(receipt.payload_json)
    except substitution_canonical.UnsupportedPayload as error:
        raise _UnsupportedPhasePayloadVersion(str(error)) from error
    try:
        payload = await rebuild_correction_payload(db, subject_id)
    except substitution_canonical.UnsupportedPayload as error:
        raise _EvidenceMissing(str(error)) from error
    return None if payload is None else _Rebuilt(payload)


SUBJECT_RECONSTRUCTORS: Mapping[SubjectType, _Reconstructor] = MappingProxyType({
    SubjectType.TRIP: _rebuild_trip,
    SubjectType.VEHICLE_EVENT: _rebuild_vehicle_event,
    SubjectType.DRIVER_EVENT: _rebuild_driver_event,
    SubjectType.PHASE_EVENT: _rebuild_phase_event,
    SubjectType.PRECINCT_EVENT: _rebuild_precinct_event,
    SubjectType.EVIDENCE_EVENT: _rebuild_evidence_event,
    SubjectType.DRIVER_SUBSTITUTION: _rebuild_driver_substitution,
    SubjectType.DRIVER_SUBSTITUTION_CORRECTION: _rebuild_driver_substitution_correction,
})

UNVERIFIABLE_SUBJECT_TYPES: frozenset[SubjectType] = frozenset({
    SubjectType.VEHICLE, SubjectType.DRIVER, SubjectType.AUDIT_PACK,
})


async def verify_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    hedera_service: HederaService | None = None,
    receipt_id: uuid.UUID | None = None,
) -> VerifyOutcome:
    """Re-check a subject's receipt against live rows and Hedera.

    receipt_id pins the check to one receipt (an audit pack's frozen reference); by default
    the subject's latest receipt is checked.
    """
    receipt = await _latest_receipt(db, subject_type, subject_id, receipt_id)
    if receipt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT)

    reconstructor = SUBJECT_RECONSTRUCTORS.get(subject_type)
    if reconstructor is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)

    try:
        rebuilt = await reconstructor(db, subject_id, receipt)
    except _UnsupportedPhasePayloadVersion:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
    except (_PhaseEvidenceMissing, _EvidenceMissing):
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
        )
    if rebuilt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
    phase_state = rebuilt.phase_state
    current_hash = _hash_payload(rebuilt.payload)

    if current_hash != receipt.data_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
            current_hash=current_hash,
        )

    if phase_state is not None and phase_state.artifacts:
        mismatch = await _live_artifact_mismatch(phase_state, receipt)
        if mismatch is not None:
            return mismatch

    evidence_state = rebuilt.evidence_state
    if evidence_state is not None:
        mismatch = await _evidence_event_mismatch(db, subject_id, evidence_state, receipt)
        if mismatch is not None:
            return mismatch

    if not receipt.hedera_topic_id or not receipt.hedera_sequence_number:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)

    try:
        service = hedera_service or HederaService()
        match = await asyncio.to_thread(
            service.verify_hash,
            receipt.hedera_topic_id,
            receipt.hedera_sequence_number,
            receipt.data_hash,
        )
    except HederaServiceError:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
    if not match:
        return VerifyOutcome(
            status=VerifyStatus.HEDERA_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
        )

    return VerifyOutcome(
        status=VerifyStatus.VERIFIED,
        receipt=receipt,
        evidence_verified=any(
            state is not None and bool(state.artifacts) for state in (phase_state, evidence_state)
        ),
    )


async def verify_visible_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> VerifyOutcome:
    """Verify a subject only after proving it belongs to the caller's organisation.

    The visibility check comes first so a foreign subject is never read, let alone
    re-hashed or looked up on Hedera. Raises SubjectNotVisibleError (the endpoint maps it
    to 404) and verifies nothing in that case.
    """
    await assert_subject_visible(
        db, subject_type=subject_type, subject_id=subject_id, organization_id=organization_id,
    )
    return await verify_subject(db, subject_type=subject_type, subject_id=subject_id)
