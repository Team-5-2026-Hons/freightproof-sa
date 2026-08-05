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
#                   driver never drives it through a capture flow. Its old
#                   "1-arrival" step was UI ceremony over an auto-completed phase:
#                   it asked the driver to tap a GPS button whose fix the submit
#                   path never even sent.
#
# The three GPS-capture steps are gone (2026-08-05): activation's "1-approach-gate",
# departure's "1-approach-exit", and in_transit's "1-arrival" each existed only to
# make the driver tap "Capture GPS Location" behind a swipe gate. The PWA now takes
# the fix silently as the driver confirms each phase (driver_phone_lat/lng on every
# *CompleteRequest) and records a continuous trail in trip_location_pings, so the
# position is captured MORE often than before, with no step to walk. Surviving slugs
# keep their original numbers — the prefix orders the tuple, it is not an index, and
# renumbering would break every deep link and stored draft key for no visible gain.
#
# loading is NOT empty (Stage 5, D11). It was, on the reading that the phase is
# wholly system-observed via the Parcel Perfect poll — but advance_loading()
# requires driver_visual_count, is the only dispatch-table entry that can close
# this phase, and nothing else in the codebase calls it, so an empty recipe left
# `loading` uncompletable and starved advance_confirmation() of the origin_count
# its three-way reconciliation verdict compares against.
#
# This does not weaken F1. F1 forbids showing the driver an EXPECTED count, not
# the driver entering their own: the count is entered blind — no expected value,
# no Parcel Perfect figure, no mismatch banner — and the server reconciles it
# privately. A count typed while the target number is on screen proves nothing;
# a blind one is exactly what makes the reconciliation meaningful.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("2-verification",),
    PhaseType.LOADING: ("1-visual-count",),
    PhaseType.DEPARTURE: ("2-capture-seal", "3-waybill", "4-departure"),
    PhaseType.IN_TRANSIT: (),
    PhaseType.UNLOADING: (
        "1-hand-waybill", "2-seal-verify", "3-seal-break-inspection", "4-visual-count",
    ),
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-pod-signature", "3-reconciliation", "4-closed"),
}
