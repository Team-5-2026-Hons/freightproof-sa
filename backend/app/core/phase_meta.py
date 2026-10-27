"""Per-phase-type driver step recipes; must mirror frontend/shared/lib/constants/phase-meta.ts
(see tests/unit/test_phase_meta_contract.py). Keyed by phase TYPE, not index.
"""

from app.db.models.enums import EvidenceRole, PhaseType

STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("2-verification",),
    PhaseType.LOADING: ("1-linehaul",),
    PhaseType.DEPARTURE: ("2-capture-seal", "4-departure"),
    PhaseType.IN_TRANSIT: (),
    PhaseType.ARRIVAL: ("2-seal-verify",),
    PhaseType.UNLOADING: ("4-visual-count",),
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-receiver-handover", "3-reconciliation", "4-closed"),
}

EVIDENCE_ROLES: dict[PhaseType, frozenset[EvidenceRole]] = {
    PhaseType.TRIP_CREATION: frozenset(),
    PhaseType.ACTIVATION: frozenset(),
    PhaseType.LOADING: frozenset({EvidenceRole.LINEHAUL_PHOTO, EvidenceRole.LINEHAUL_PDF}),
    PhaseType.DEPARTURE: frozenset({EvidenceRole.SEAL_PHOTO, EvidenceRole.WAYBILL_PHOTO}),
    PhaseType.IN_TRANSIT: frozenset(),
    PhaseType.ARRIVAL: frozenset({EvidenceRole.SEAL_PHOTO}),
    PhaseType.UNLOADING: frozenset(),
    PhaseType.CONFIRMATION: frozenset({EvidenceRole.POD_PHOTO, EvidenceRole.POD_SIGNATURE}),
}

DRIVER_UPLOAD_ROLES: frozenset[EvidenceRole] = frozenset(EvidenceRole) - {EvidenceRole.POD_SIGNATURE}
