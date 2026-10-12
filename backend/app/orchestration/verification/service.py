"""Verify a subject's current DB state against its anchored Hedera record.

Returns one of: verified, db_mismatch, hedera_mismatch, no_receipt, error.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import HederaServiceError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType, VerifyStatus
from app.orchestration.verification.errors import _UnsupportedPhasePayloadVersion
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
    _reconstruct_phase_event_payload,
)
from app.orchestration.verification.trip_payloads import _reconstruct_trip_payload
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError,
    EvidenceStorageUnavailableError,
)


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    receipt: BlockchainReceipt | None = None
    expected_hash: str | None = None
    current_hash: str | None = None
    evidence_verified: bool = False


async def _latest_receipt(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID
) -> BlockchainReceipt | None:
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            BlockchainReceipt.subject_type == subject_type,
            BlockchainReceipt.subject_id == subject_id,
        )
        .order_by(desc(BlockchainReceipt.created_at))
        .limit(1)
    )
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


async def verify_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    hedera_service: HederaService | None = None,
) -> VerifyOutcome:
    receipt = await _latest_receipt(db, subject_type, subject_id)
    if receipt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT)

    phase_state: _PhasePayloadState | None = None
    if subject_type == SubjectType.TRIP:
        try:
            rebuilt = await _reconstruct_trip_payload(
                db, subject_id, anchored_payload=receipt.payload_json,
            )
        except _UnsupportedPhasePayloadVersion:
            return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.VEHICLE_EVENT:
        rebuilt = await _reconstruct_vehicle_event_payload(
            db, subject_id, anchored_payload=receipt.payload_json,
        )
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.DRIVER_EVENT:
        rebuilt = await _reconstruct_driver_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.PHASE_EVENT:
        try:
            phase_state = await _reconstruct_phase_event_payload(
                db, subject_id, anchored_payload=receipt.payload_json,
            )
        except _UnsupportedPhasePayloadVersion:
            return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
        except _PhaseEvidenceMissing:
            return VerifyOutcome(
                status=VerifyStatus.DB_MISMATCH,
                receipt=receipt,
                expected_hash=receipt.data_hash,
            )
        current_hash = _hash_payload(phase_state.payload)
    elif subject_type == SubjectType.PRECINCT_EVENT:
        rebuilt = await _reconstruct_precinct_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    else:
        # vehicle/driver subject types not currently verifiable directly
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)

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

    if not receipt.hedera_topic_id or not receipt.hedera_sequence_number:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)

    try:
        service = hedera_service or HederaService()
        # verify_hash() is a synchronous httpx GET to the Hedera mirror node (up to a
        # 10s timeout) — run it off the event loop so a slow mirror node stalls only
        # this request, not every other request the server is handling.
        match = await asyncio.to_thread(
            service.verify_hash,
            receipt.hedera_topic_id,
            receipt.hedera_sequence_number,
            receipt.data_hash,
        )
    except HederaServiceError:
        # Mirror node unreachable, bad stored topic_id, SDK error — infrastructure failure,
        # not evidence of tamper. Return ERROR so the UI can distinguish it from HEDERA_MISMATCH.
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
        evidence_verified=phase_state is not None and bool(phase_state.artifacts),
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
