"""Per-phase-type driver step recipes; must mirror frontend/shared/lib/constants/phase-meta.ts
(see tests/unit/test_phase_meta_contract.py). Keyed by phase TYPE, not index.
"""

from app.db.models.enums import EvidenceRole, PhaseType

# Empty recipe = no driver step page (trip_creation is dispatcher-side; in_transit uses the hub swipe).
# Slug numeric prefixes order the tuple only; gaps are expected and slugs are never renumbered.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("2-verification",),
    PhaseType.LOADING: ("1-linehaul",),
    PhaseType.DEPARTURE: ("2-capture-seal", "4-departure"),
    PhaseType.IN_TRANSIT: (),
    # The seal inspection moved here from unloading, slug unchanged: it is the only
    # evidence that expires once the truck is opened, so it gets its own phase that
    # must complete before unloading can start.
    PhaseType.ARRIVAL: ("2-seal-verify",),
    PhaseType.UNLOADING: ("4-visual-count",),
    # receiver-handover signature is captured on the receiver's own device (handover.py), not the driver's.
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-receiver-handover", "3-reconciliation", "4-closed"),
}

# Evidence roles a capture may be attributed to, per phase TYPE. Empty = the phase cites no
# artifact. Mirrored by EVIDENCE_ROLES in the shared phase-meta.ts (same parity test).
EVIDENCE_ROLES: dict[PhaseType, frozenset[EvidenceRole]] = {
    PhaseType.TRIP_CREATION: frozenset(),
    PhaseType.ACTIVATION: frozenset(),
    PhaseType.LOADING: frozenset({EvidenceRole.LINEHAUL_PHOTO}),
    # waybill_photo is only produced by legacy queued departure entries; kept so they still attribute.
    PhaseType.DEPARTURE: frozenset({EvidenceRole.SEAL_PHOTO, EvidenceRole.WAYBILL_PHOTO}),
    PhaseType.IN_TRANSIT: frozenset(),
    PhaseType.ARRIVAL: frozenset({EvidenceRole.SEAL_PHOTO}),
    PhaseType.UNLOADING: frozenset(),
    PhaseType.CONFIRMATION: frozenset({EvidenceRole.POD_PHOTO, EvidenceRole.POD_SIGNATURE}),
}

# The receiver's confirmation is attributed server-side from the handover token; a driver
# upload must never be able to claim it, or the dispatcher's "Receiver confirmed" would be forgeable.
DRIVER_UPLOAD_ROLES: frozenset[EvidenceRole] = frozenset(EvidenceRole) - {EvidenceRole.POD_SIGNATURE}
