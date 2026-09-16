"""Per-phase-type driver step recipes; must mirror frontend/shared/lib/constants/phase-meta.ts
(see tests/unit/test_phase_meta_contract.py). Keyed by phase TYPE, not index.
"""

from app.db.models.enums import PhaseType

# Empty recipe = no driver step page (trip_creation is dispatcher-side; in_transit uses the hub swipe).
# Slug numeric prefixes order the tuple only; gaps are expected and slugs are never renumbered.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("2-verification",),
    PhaseType.LOADING: ("1-linehaul",),
    PhaseType.DEPARTURE: ("2-capture-seal", "4-departure"),
    PhaseType.IN_TRANSIT: (),
    # Seal photo first: the only evidence that expires once the truck is opened.
    PhaseType.UNLOADING: ("2-seal-verify", "4-visual-count"),
    # receiver-handover signature is captured on the receiver's own device (handover.py), not the driver's.
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-receiver-handover", "3-reconciliation", "4-closed"),
}
