"""Rebuild a phase event's anchored payload from live rows and re-hash the evidence behind it."""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, PhaseType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.payloads import (
    PHASE_PAYLOAD_VERSION_V2,
    PHASE_PAYLOAD_VERSION_V3,
    compute_activation_canonical_payload_v2,
    compute_arrival_canonical_payload_v2,
    compute_confirmation_canonical_payload_v1,
    compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v1,
    compute_departure_canonical_payload_v2,
    compute_in_transit_canonical_payload_v2,
    compute_loading_canonical_payload_v2,
    compute_loading_canonical_payload_v3,
    compute_override_canonical_payload_v2,
    compute_unloading_canonical_payload_v2,
)
from app.orchestration.verification.errors import _UnsupportedPhasePayloadVersion
from app.storage.supabase_storage import hash_stored_evidence_file

_LEGACY_PHASE_PAYLOAD_VERSION = 1
# Phases first anchored on 2026-09-23, when every phase started anchoring. They only
# ever produced v2 payloads; loading and unloading keep their separate pre-phase legacy
# handshake contracts below, matched by exact key set before this set is consulted.
_V2_ONLY_PHASE_TYPES = frozenset({
    PhaseType.ACTIVATION, PhaseType.LOADING, PhaseType.IN_TRANSIT,
    PhaseType.ARRIVAL, PhaseType.UNLOADING,
})
_LEGACY_LOADING_PAYLOAD_KEYS = frozenset({
    "handshake_event_id", "trip_id", "handshake_type", "seal_number",
    "driver_visual_count",
})
_LEGACY_UNLOADING_PAYLOAD_KEYS = frozenset({
    "handshake_event_id", "trip_id", "handshake_type", "pp_scan_in_count",
    "driver_visual_count",
})


@dataclass(frozen=True)
class _ArtifactCommitment:
    payload_key: str
    artifact: EvidenceArtifact


@dataclass(frozen=True)
class _PhasePayloadState:
    payload: dict[str, Any]
    artifacts: tuple[_ArtifactCommitment, ...] = ()


class _PhaseEvidenceMissing(ValueError):
    """A receipt's committed phase state is absent from the current database."""


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _phase_payload_version(anchored_payload: Any) -> int:
    if not isinstance(anchored_payload, dict):
        raise _UnsupportedPhasePayloadVersion("phase receipt payload must be a JSON object")
    if "payload_version" not in anchored_payload:
        return _LEGACY_PHASE_PAYLOAD_VERSION

    version = anchored_payload["payload_version"]
    if type(version) is not int or version not in (PHASE_PAYLOAD_VERSION_V2, PHASE_PAYLOAD_VERSION_V3):
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

    The seal — and the anchor with it — moved from loading to departure, so this
    dispatches on PhaseType.DEPARTURE, not LOADING, and no longer needs
    driver_visual_count (which stays on loading, unanchored).

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
    if version == PHASE_PAYLOAD_VERSION_V3 and event.phase_type != PhaseType.LOADING:
        # v3 exists only for loading (the linehaul PDF). Checked before the OVERRIDDEN branch
        # so a v3-labelled receipt on an overridden row is unsupported, not a hash mismatch.
        raise _UnsupportedPhasePayloadVersion("payload version 3 exists only for loading")
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
    if event.status == PhaseStatus.OVERRIDDEN:
        # Checked before any phase-type branch: an overridden row anchored the override
        # record (PHASE_OVERRIDE), never its phase's own payload. v2 only, because
        # overrides were not anchored at all before v2 existed.
        if version == _LEGACY_PHASE_PAYLOAD_VERSION:
            raise _PhaseEvidenceMissing("overrides have no legacy payload")
        if event.dispatcher_override_user_id is None or event.dispatcher_override_note is None:
            raise _PhaseEvidenceMissing("anchored override fields are missing")
        return _PhasePayloadState(payload=compute_override_canonical_payload_v2(
            phase_event_id=event.id, trip_id=event.trip_id,
            phase_type=PhaseType(event.phase_type),
            override_user_id=event.dispatcher_override_user_id,
            override_note=event.dispatcher_override_note,
        ))
    if event.phase_type in _V2_ONLY_PHASE_TYPES and version == _LEGACY_PHASE_PAYLOAD_VERSION:
        # These phases started anchoring after v2 existed, so an unversioned payload for
        # one of them is not a real receipt shape and must not verify.
        raise _PhaseEvidenceMissing("this phase type has no legacy payload")
    if event.phase_type in (PhaseType.ACTIVATION, PhaseType.IN_TRANSIT, PhaseType.UNLOADING):
        builder = {
            PhaseType.ACTIVATION: compute_activation_canonical_payload_v2,
            PhaseType.IN_TRANSIT: compute_in_transit_canonical_payload_v2,
            PhaseType.UNLOADING: compute_unloading_canonical_payload_v2,
        }[PhaseType(event.phase_type)]
        return _PhasePayloadState(payload=builder(phase_event_id=event.id, trip_id=event.trip_id))
    if event.phase_type == PhaseType.LOADING:
        roles: list[tuple[str, uuid.UUID]] = []
        if event.linehaul_photo_artifact_id is not None:
            roles.append(("linehaul_photo_sha256", event.linehaul_photo_artifact_id))
        if version == PHASE_PAYLOAD_VERSION_V3 and event.linehaul_pdf_artifact_id is not None:
            roles.append(("linehaul_pdf_sha256", event.linehaul_pdf_artifact_id))
        loading_artifacts = (
            await _load_artifacts_for_roles(db, event=event, roles=tuple(roles)) if roles else ()
        )
        hashes = {item.payload_key: item.artifact.file_hash for item in loading_artifacts}
        if version == PHASE_PAYLOAD_VERSION_V3:
            return _PhasePayloadState(
                payload=compute_loading_canonical_payload_v3(
                    phase_event_id=event.id, trip_id=event.trip_id,
                    parcel_count_origin=event.parcel_count_origin,
                    linehaul_photo_sha256=hashes.get("linehaul_photo_sha256"),
                    linehaul_pdf_sha256=hashes.get("linehaul_pdf_sha256"),
                ),
                artifacts=loading_artifacts,
            )
        return _PhasePayloadState(
            payload=compute_loading_canonical_payload_v2(
                phase_event_id=event.id, trip_id=event.trip_id,
                parcel_count_origin=event.parcel_count_origin,
                linehaul_photo_sha256=hashes.get("linehaul_photo_sha256"),
            ),
            artifacts=loading_artifacts,
        )
    if event.phase_type == PhaseType.ARRIVAL:
        if event.seal_condition is None or event.seal_photo_artifact_id is None:
            raise _PhaseEvidenceMissing("anchored arrival seal evidence is missing")
        arrival_artifacts = await _load_artifacts_for_roles(
            db, event=event, roles=(("seal_photo_sha256", event.seal_photo_artifact_id),),
        )
        return _PhasePayloadState(
            payload=compute_arrival_canonical_payload_v2(
                phase_event_id=event.id, trip_id=event.trip_id,
                seal_number=event.seal_number,
                seal_condition=event.seal_condition,
                seal_photo_sha256=arrival_artifacts[0].artifact.file_hash,
            ),
            artifacts=arrival_artifacts,
        )
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
    Trying every contract also recovers anchors queued before v2, and loading anchors queued as v3.
    """
    for contract in (
        {}, {"payload_version": PHASE_PAYLOAD_VERSION_V2}, {"payload_version": PHASE_PAYLOAD_VERSION_V3},
    ):
        try:
            state = await _reconstruct_phase_event_payload(db, event.id, anchored_payload=contract)
        except (_PhaseEvidenceMissing, _UnsupportedPhasePayloadVersion):
            # A contract this phase type never produced (v3 off loading) is simply not a
            # match; move on to the next one rather than abandoning recovery.
            continue
        if _hash_payload(state.payload) == event.event_hash:
            return state.payload
    return None
