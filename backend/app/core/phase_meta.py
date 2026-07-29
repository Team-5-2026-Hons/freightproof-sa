"""Static per-phase-type driver step recipes — the `step_recipe` half of the
frozen contract's PhaseDescriptor (parent plan §3.1).

Decision S2 (Stage 3): the backend owns this list and serves it, so the client
computes nothing. That duplicates frontend/shared/lib/constants/phase-meta.ts,
which is only safe because tests/unit/test_phase_meta_contract.py parses that
file and fails if the two disagree. If you edit one, edit both — the test will
tell you if you forget.

Keyed by phase TYPE, never by index: how many times a type occurs in a trip is
data (a cross-dock plan has `loading` twice), so a Record<0..5, ...> here would
reintroduce exactly the fixed-length assumption this refactor removes.
"""

from app.db.models.enums import PhaseType

# An empty recipe means no driver interaction:
#   trip_creation — dispatcher-side, before the driver is involved at all.
#   in_transit    — closed by departure today (NEW-8 stopgap) and by checkpoint
#                   Merkle batches once those exist (parent D2); either way the
#                   driver never drives it through a capture flow.
#   loading       — system-observed via the Parcel Perfect poll. The driver must
#                   never see the expected count (F1): if the number is on screen,
#                   a "match" proves nothing.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("1-approach-gate", "2-verification"),
    PhaseType.LOADING: (),
    PhaseType.DEPARTURE: ("1-approach-exit", "2-capture-seal", "3-waybill", "4-departure"),
    PhaseType.IN_TRANSIT: ("1-arrival",),
    PhaseType.UNLOADING: (
        "1-hand-waybill", "2-seal-verify", "3-seal-break-inspection", "4-visual-count",
    ),
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-pod-signature", "3-reconciliation", "4-closed"),
}
