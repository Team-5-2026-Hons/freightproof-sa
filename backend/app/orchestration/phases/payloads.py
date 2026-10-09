"""Canonical payload builders for phase anchors: pure functions, no DB. Imported by the phase
advance modules and by verification_service, which rebuilds the same payloads to verify a
stored hash.
"""

import hashlib
import uuid

from app.db.models.enums import PhaseStatus, PhaseType


PHASE_PAYLOAD_VERSION_V2 = 2


def compute_departure_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
) -> dict[str, str]:
    """Reproduce the legacy departure payload for pre-FP-154 receipts.

    JSON-native (UUIDs stringified explicitly) so compute_payload_hash's plain
    json.dumps (no default=str fallback) never has to guess how to serialize a
    value. Deliberately excludes GPS, photos, and artifact IDs — only hashes of
    evidence belong on-chain, never GPS/PII (POPIA); completed_at is excluded
    too, to avoid datetime round-trip fragility when verification reconstructs
    this payload later. driver_visual_count is gone: the count
    stays on loading, unanchored, and departure has no reason to fetch a value
    from a different PhaseEvent row just to anchor it.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": seal_number,
    }


def compute_departure_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
    seal_photo_sha256: str, waybill_photo_sha256: str | None,
) -> dict[str, str | int | None]:
    """Canonical departure payload with role-labelled evidence commitments.

    Artifact IDs and Storage paths remain off-chain. The optional waybill key is
    always present so reconstruction has one deterministic v2 shape.
    """
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": seal_number,
        "seal_photo_sha256": seal_photo_sha256,
        "waybill_photo_sha256": waybill_photo_sha256,
    }


def _phase_payload_base(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, phase_type: PhaseType,
) -> dict[str, str | int | None]:
    """The v2 keys every phase payload starts with. Same rules as the departure payload:
    no GPS, no artifact IDs or storage paths, no PII, and no completed_at (a datetime
    would have to round-trip exactly through the database for verification to rebuild
    the same hash). Location evidence stays off-chain on the row this payload names."""
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": phase_type.value,
    }


def compute_activation_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: the fact anchored is that the driver took custody, and when HCS saw it."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.ACTIVATION,
    )


def compute_loading_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, parcel_count_origin: int | None,
    linehaul_photo_sha256: str | None,
) -> dict[str, str | int | None]:
    """The scanned-out count and the linehaul sheet. Both keys are always present, None
    when absent, so reconstruction has one deterministic shape (see the departure
    payload's optional waybill key)."""
    return {
        **_phase_payload_base(
            phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.LOADING,
        ),
        "parcel_count_origin": parcel_count_origin,
        "linehaul_photo_sha256": linehaul_photo_sha256,
    }


def compute_in_transit_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: the driver's "I have arrived" attestation is itself the fact."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.IN_TRANSIT,
    )


def compute_arrival_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str | None,
    seal_condition: str, seal_photo_sha256: str,
) -> dict[str, str | int | None]:
    """The seal as found at the gate. seal_number is None only for a missing seal."""
    return {
        **_phase_payload_base(
            phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.ARRIVAL,
        ),
        "seal_number": seal_number,
        "seal_condition": seal_condition,
        "seal_photo_sha256": seal_photo_sha256,
    }


def compute_unloading_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: unloading's counts are reconciled and anchored at confirmation."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.UNLOADING,
    )


def _override_commitment(phase_event_id: uuid.UUID, value: str) -> str:
    """SHA-256 of a value salted with its phase row's id.

    What the salt does: the same note or dispatcher id hashes differently on every row,
    so one precomputed table of guesses cannot be matched against every override at
    once, and two overrides cannot be linked by an identical hash. What it does NOT do:
    the salt (phase_event_id) is in the payload itself, so anyone holding a payload can
    still test candidate notes against that one row. It is a commitment, not
    encryption. That is acceptable because the plain note stays in PostgreSQL (POPIA)
    and a short note guessed back reveals only what an auditor would be shown anyway.
    Verification rehashes the plain value stored on the row."""
    return hashlib.sha256(f"{phase_event_id}:{value}".encode("utf-8")).hexdigest()


def compute_override_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, phase_type: PhaseType,
    override_user_id: uuid.UUID, override_note: str,
) -> dict[str, str | int | None]:
    """Who overrode which phase, and why, as commitments. The note is free text that may
    name a person, so only its keyed hash leaves the database (POPIA)."""
    return {
        **_phase_payload_base(phase_event_id=phase_event_id, trip_id=trip_id, phase_type=phase_type),
        "phase_status": PhaseStatus.OVERRIDDEN.value,
        "overridden_by_sha256": _override_commitment(phase_event_id, str(override_user_id)),
        "override_note_sha256": _override_commitment(phase_event_id, override_note),
    }


def compute_confirmation_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int,
    driver_visual_count: int | None,
) -> dict[str, str | int | None]:
    """Reproduce the legacy confirmation payload for pre-FP-154 receipts.

    Anchored unconditionally, independent of whether the counts match — a
    mismatch is evidence in its own right (recorded separately as a
    TripException), not a reason to withhold the anchor. Same POPIA/JSON-native
    rules as the departure payload: no GPS/photos/PII, no completed_at.

    phase_type is "confirmation", not "unloading" — this corrects a
    pre-existing mislabel, not just a rename: this builder has only ever been
    called from the confirmation phase, the old value was simply wrong from
    day one. It does not change which phase anchors.

    driver_visual_count is Optional (the driver may skip the count): the key
    stays PRESENT with value None rather than being omitted when absent.
    canonicalize_payload is a plain json.dumps(sort_keys=True), so None
    serialises to `null` deterministically either way — but an omitted key
    would change the payload's SHAPE, not just one value, and
    verification_service._reconstruct_phase_event_payload rebuilds this exact
    dict from the stored column on every verify, so the key's presence must be
    unconditional for that rebuild to reproduce the original hash.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
    }


def compute_confirmation_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int,
    driver_visual_count: int | None, pod_photo_sha256: str,
    pod_signature_sha256: str,
) -> dict[str, str | int | None]:
    """Canonical confirmation payload with separate POD and signature commitments."""
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
        "pod_photo_sha256": pod_photo_sha256,
        "pod_signature_sha256": pod_signature_sha256,
    }
