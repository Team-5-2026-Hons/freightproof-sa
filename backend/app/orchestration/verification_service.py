"""Verify a subject's current DB state against its anchored Hedera record.

Returns one of: verified, db_mismatch, hedera_mismatch, no_receipt, error.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.core.exceptions import HederaServiceError
from app.crypto.hashing import compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.evidence import EvidenceArtifact
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.db.models.enums import PhaseType, SubjectType, VerifyStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripTrailer
from app.orchestration.phase_service import (
    PHASE_PAYLOAD_VERSION_V2,
    compute_confirmation_canonical_payload_v1,
    compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v1,
    compute_departure_canonical_payload_v2,
)
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError,
    EvidenceStorageUnavailableError,
    hash_stored_evidence_file,
)

_LEGACY_PHASE_PAYLOAD_VERSION = 1
_LEGACY_LOADING_PAYLOAD_KEYS = frozenset({
    "handshake_event_id", "trip_id", "handshake_type", "seal_number",
    "driver_visual_count",
})
_LEGACY_UNLOADING_PAYLOAD_KEYS = frozenset({
    "handshake_event_id", "trip_id", "handshake_type", "pp_scan_in_count",
    "driver_visual_count",
})


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    receipt: BlockchainReceipt | None = None
    expected_hash: str | None = None
    current_hash: str | None = None
    evidence_verified: bool = False


@dataclass(frozen=True)
class _ArtifactCommitment:
    payload_key: str
    artifact: EvidenceArtifact


@dataclass(frozen=True)
class _PhasePayloadState:
    payload: dict[str, Any]
    artifacts: tuple[_ArtifactCommitment, ...] = ()


class _UnsupportedPhasePayloadVersion(ValueError):
    """The receipt cannot be reconstructed under a known canonical contract."""


class _PhaseEvidenceMissing(ValueError):
    """A receipt's committed phase state is absent from the current database."""


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


async def _reconstruct_trip_payload(
    db: AsyncSession, trip_id: uuid.UUID, *, anchored_payload: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Rebuild the canonical trip payload from live DB rows, version-dispatching trip_type.

    trip_type is only included if the originally anchored payload had it. Older
    trips were anchored before trip_type existed, so recomputing with it set would
    change the hash and produce a false DB_MISMATCH ("tampering") on untouched rows.
    """
    trip = (
        await db.execute(select(Trip).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if trip is None:
        return None
    trailer_rows = (
        await db.execute(
            select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip_id)
        )
    ).scalars().all()
    if trip.origin_precinct_id is None or trip.destination_precinct_id is None:
        # Precincts are set at trip creation; a receipt shouldn't exist before that,
        # but treat it like the other reconstruct_* helpers' not-found case either way.
        return None
    include_trip_type = anchored_payload is not None and "trip_type" in anchored_payload
    return compute_trip_canonical_payload(
        trip_id=trip.id,
        order_number=trip.order_number,
        driver_id=trip.driver_id,
        horse_id=trip.horse_id,
        trailer_ids=list(trailer_rows),
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=trip.created_by_user_id,
        created_at=trip.created_at,
        trip_type=trip.trip_type if include_trip_type else None,
    )


async def _reconstruct_vehicle_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    event = (
        await db.execute(select(VehicleEvent).where(VehicleEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "vehicle_event_id": str(event.id),
        "vehicle_id": str(event.vehicle_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


async def _reconstruct_driver_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    event = (
        await db.execute(select(DriverEvent).where(DriverEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "driver_event_id": str(event.id),
        "driver_id": str(event.driver_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


def _phase_payload_version(anchored_payload: Any) -> int:
    if not isinstance(anchored_payload, dict):
        raise _UnsupportedPhasePayloadVersion("phase receipt payload must be a JSON object")
    if "payload_version" not in anchored_payload:
        return _LEGACY_PHASE_PAYLOAD_VERSION

    version = anchored_payload["payload_version"]
    if type(version) is not int or version != PHASE_PAYLOAD_VERSION_V2:
        raise _UnsupportedPhasePayloadVersion(f"unsupported phase payload version: {version!r}")
    return version


def _legacy_handshake_contract(anchored_payload: dict[str, Any]) -> str | None:
    """Identify receipts retained by handshake_events -> phase_events migration.

    That migration changed the receipt discriminator but deliberately preserved
    payload_json. Exact key sets keep malformed unversioned payloads from being
    silently interpreted as one of these frozen pre-phase contracts.
    """
    keys = frozenset(anchored_payload)
    handshake_type = anchored_payload.get("handshake_type")
    if keys == _LEGACY_LOADING_PAYLOAD_KEYS and handshake_type == "loading":
        return "loading"
    if keys == _LEGACY_UNLOADING_PAYLOAD_KEYS and handshake_type == "unloading":
        return "unloading"
    if "handshake_event_id" in anchored_payload or "handshake_type" in anchored_payload:
        raise _UnsupportedPhasePayloadVersion("unsupported legacy handshake payload shape")
    return None


async def _load_artifacts_for_roles(
    db: AsyncSession,
    *,
    event: PhaseEvent,
    roles: tuple[tuple[str, uuid.UUID], ...],
) -> tuple[_ArtifactCommitment, ...]:
    artifact_ids = {artifact_id for _, artifact_id in roles}
    result = await db.execute(
        select(EvidenceArtifact).where(
            EvidenceArtifact.id.in_(artifact_ids),
            EvidenceArtifact.trip_id == event.trip_id,
        )
    )
    artifacts = {artifact.id: artifact for artifact in result.scalars().all()}
    if artifact_ids - artifacts.keys():
        raise _PhaseEvidenceMissing("anchored phase evidence is missing or belongs to another trip")
    return tuple(
        _ArtifactCommitment(payload_key=payload_key, artifact=artifacts[artifact_id])
        for payload_key, artifact_id in roles
    )


async def _reconstruct_phase_event_payload(
    db: AsyncSession, event_id: uuid.UUID, *, anchored_payload: Any,
) -> _PhasePayloadState:
    """Rebuild the version selected by the immutable receipt payload.

    Missing payload_version selects one of two immutable legacy generations:
    the pre-phase handshake shape preserved by the phase migration, or the
    departure/confirmation v1 shape. New v2 receipts also return the role-to-
    artifact mapping needed to hash the current private Storage bytes.

    Task 2.6 (D7/T5) moved the seal — and the anchor with it — from loading to
    departure, so this dispatches on PhaseType.DEPARTURE, not LOADING, and no
    longer needs driver_visual_count (which stays on loading, unanchored).

    driver_visual_count is no longer part of the CONFIRMATION completeness
    check below: it is now Optional on the request (the driver may skip the
    count), so a genuinely anchored confirmation can legitimately have it as
    NULL. parcel_count_destination alone is the correct completeness signal —
    advance_confirmation always sets it to an int (never None, defaulting to 0
    on an empty leg) before it ever anchors, so a NULL there still means "this
    phase hasn't completed yet", exactly as before.
    """
    event = (
        await db.execute(select(PhaseEvent).where(PhaseEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        raise _PhaseEvidenceMissing("anchored phase event is missing")
    version = _phase_payload_version(anchored_payload)
    if version == _LEGACY_PHASE_PAYLOAD_VERSION:
        legacy_handshake = _legacy_handshake_contract(anchored_payload)
        if legacy_handshake == "loading":
            if (
                event.phase_type != PhaseType.LOADING
                or event.seal_number is None
                or event.driver_visual_count is None
            ):
                raise _PhaseEvidenceMissing("anchored legacy loading fields are missing")
            return _PhasePayloadState(payload={
                "handshake_event_id": str(event.id),
                "trip_id": str(event.trip_id),
                "handshake_type": "loading",
                "seal_number": event.seal_number,
                "driver_visual_count": event.driver_visual_count,
            })
        if legacy_handshake == "unloading":
            # Rows created before the phase migration retained `unloading`; rows
            # created during the transition used the new `confirmation` value but
            # still anchored the old handshake-shaped payload.
            if (
                event.phase_type not in (PhaseType.UNLOADING, PhaseType.CONFIRMATION)
                or event.parcel_count_destination is None
                or event.driver_visual_count is None
            ):
                raise _PhaseEvidenceMissing("anchored legacy unloading fields are missing")
            return _PhasePayloadState(payload={
                "handshake_event_id": str(event.id),
                "trip_id": str(event.trip_id),
                "handshake_type": "unloading",
                "pp_scan_in_count": event.parcel_count_destination,
                "driver_visual_count": event.driver_visual_count,
            })
    if event.phase_type == PhaseType.DEPARTURE:
        # seal_number is a nullable column (not yet completed), but a receipt
        # only ever exists once departure anchored it. If it's still None here,
        # report missing committed state rather than claiming no receipt exists.
        if event.seal_number is None:
            raise _PhaseEvidenceMissing("anchored departure fields are missing")
        if version == _LEGACY_PHASE_PAYLOAD_VERSION:
            return _PhasePayloadState(payload=compute_departure_canonical_payload_v1(
                phase_event_id=event.id, trip_id=event.trip_id, seal_number=event.seal_number,
            ))
        if event.seal_photo_artifact_id is None:
            raise _PhaseEvidenceMissing("departure seal evidence is missing")
        role_ids = [("seal_photo_sha256", event.seal_photo_artifact_id)]
        if event.waybill_photo_artifact_id is not None:
            role_ids.append(("waybill_photo_sha256", event.waybill_photo_artifact_id))
        artifacts = await _load_artifacts_for_roles(db, event=event, roles=tuple(role_ids))
        hashes = {item.payload_key: item.artifact.file_hash for item in artifacts}
        return _PhasePayloadState(
            payload=compute_departure_canonical_payload_v2(
                phase_event_id=event.id,
                trip_id=event.trip_id,
                seal_number=event.seal_number,
                seal_photo_sha256=hashes["seal_photo_sha256"],
                waybill_photo_sha256=hashes.get("waybill_photo_sha256"),
            ),
            artifacts=artifacts,
        )
    if event.phase_type == PhaseType.CONFIRMATION:
        if event.parcel_count_destination is None:
            raise _PhaseEvidenceMissing("anchored confirmation fields are missing")
        if version == _LEGACY_PHASE_PAYLOAD_VERSION:
            return _PhasePayloadState(payload=compute_confirmation_canonical_payload_v1(
                phase_event_id=event.id, trip_id=event.trip_id,
                pp_scan_in_count=event.parcel_count_destination,
                driver_visual_count=event.driver_visual_count,
            ))
        if event.pod_photo_artifact_id is None or event.pod_signature_artifact_id is None:
            raise _PhaseEvidenceMissing("confirmation POD evidence is missing")
        artifacts = await _load_artifacts_for_roles(
            db,
            event=event,
            roles=(
                ("pod_photo_sha256", event.pod_photo_artifact_id),
                ("pod_signature_sha256", event.pod_signature_artifact_id),
            ),
        )
        hashes = {item.payload_key: item.artifact.file_hash for item in artifacts}
        return _PhasePayloadState(
            payload=compute_confirmation_canonical_payload_v2(
                phase_event_id=event.id,
                trip_id=event.trip_id,
                pp_scan_in_count=event.parcel_count_destination,
                driver_visual_count=event.driver_visual_count,
                pod_photo_sha256=hashes["pod_photo_sha256"],
                pod_signature_sha256=hashes["pod_signature_sha256"],
            ),
            artifacts=artifacts,
        )
    raise _PhaseEvidenceMissing("anchored phase type is no longer verifiable")


async def _payload_with_live_artifact_hashes(state: _PhasePayloadState) -> dict[str, Any]:
    payload = dict(state.payload)
    live_hashes = await asyncio.gather(*(
        hash_stored_evidence_file(
            s3_bucket=commitment.artifact.s3_bucket,
            s3_key=commitment.artifact.s3_key,
        )
        for commitment in state.artifacts
    ))
    for commitment, live_hash in zip(state.artifacts, live_hashes, strict=True):
        payload[commitment.payload_key] = live_hash
    return payload


async def reconstruct_pending_phase_payload(
    db: AsyncSession, event: PhaseEvent,
) -> dict[str, Any] | None:
    """Recover a lost queue payload only if it reproduces the completion-time hash.

    The ledger already durably stores the hash and evidence links in the phase
    transaction. Never replace that hash with a reconstruction: changed/missing
    evidence must leave an explicit anchor debt, not acquire a new trusted baseline.
    Trying v1 also recovers phase anchors queued before the v2 deployment.
    """
    for contract in ({}, {"payload_version": PHASE_PAYLOAD_VERSION_V2}):
        try:
            state = await _reconstruct_phase_event_payload(db, event.id, anchored_payload=contract)
        except _PhaseEvidenceMissing:
            continue
        if _hash_payload(state.payload) == event.event_hash:
            return state.payload
    return None


async def _reconstruct_precinct_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    """Rebuild the canonical payload precinct_service anchored, from the live row.

    Key order and value shapes must match create_precinct/update_precinct exactly —
    _hash_payload sorts keys, but a renamed key or a Decimal where a float was anchored
    produces a different hash and reports a mismatch that never happened.
    """
    event = (
        await db.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "precinct_event_id": str(event.id),
        "precinct_id": str(event.precinct_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


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
        rebuilt = await _reconstruct_trip_payload(
            db, subject_id, anchored_payload=receipt.payload_json
        )
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.VEHICLE_EVENT:
        rebuilt = await _reconstruct_vehicle_event_payload(db, subject_id)
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
