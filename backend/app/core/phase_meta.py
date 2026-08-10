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
#   in_transit    — IS driver-submitted as of 2026-08-09 (advance_in_transit), but from
#                   the driver app's in-transit hub swipe, never a step page — so it has
#                   an owner and still has no capture flow. The empty recipe is what keeps
#                   arrival off the step router: driver-pwa's actionablePhase() skips any
#                   phase whose recipe is empty, which is exactly the behaviour the hub
#                   relies on. Giving this a recipe would reroute the driver and change
#                   this shared contract; that was considered and deliberately rejected.
#                   Its old "1-arrival" step was UI ceremony: it asked the driver to tap a
#                   GPS button whose fix the submit path never even sent. The fix now
#                   rides on the attestation itself.
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
# unloading's "3-seal-break-inspection" is gone for the same reason (2026-08-05): it
# photographed the seal AFTER the warehouse broke it, which proves nothing about the
# journey. The tamper-evidence bookend is departure's seal photo and the INTACT photo
# taken on "2-seal-verify" — together those two are what show the trailer was not
# opened in transit. The broken-seal photo was never even sent to this server;
# UnloadingCompleteRequest has no field for it. Surviving slugs keep their numbers.
#
# loading's step is the LINEHAUL, not a count (2026-08-05). The driver never enters the
# warehouse and may reach the truck after loading finished, so a parcel count is a number
# he cannot honestly produce — and manifest_service records Bruce's rule that he counts
# pallets, never parcels, in any case. The phase is now gated on the warehouse closing its
# scan session (orchestration/phase_gate.py) and closed by the driver confirming the
# linehaul document, which is the driver-safe view he is actually given.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("2-verification",),
    PhaseType.LOADING: ("1-linehaul",),
    # "3-waybill" is gone (2026-08-10). Despite the slug it photographed the LINEHAUL
    # DOCUMENT — the same physical sheet loading's "1-linehaul" step already captures,
    # handed to the driver by the warehouse. Asking twice produced two artifacts of one
    # document and left the evidence chain with no principled way to say which is the
    # copy of record. Loading keeps it, because that is where the handover happens.
    # DepartureCompleteRequest.waybill_photo_artifact_id is now Optional rather than
    # deleted, so a departure queued offline by an older app build still drains instead
    # of 422-ing forever; nothing writes it any more. Surviving slugs keep their numbers.
    PhaseType.DEPARTURE: ("2-capture-seal", "4-departure"),
    PhaseType.IN_TRANSIT: (),
    # Seal photo FIRST (2026-08-08): the intact seal is the one piece of evidence that
    # expires the instant the truck is opened, so it is captured before anything else at
    # the stop. "1-hand-waybill" is gone — it sent nothing to the server (see
    # schemas/phases.py UnloadingCompleteRequest, which takes only the seal number and
    # photo), so dropping it loses no evidence. Surviving slugs keep their original
    # numbers: the prefix orders the recipe, it is not an index, and renumbering would
    # break every stored draft key and deep link.
    PhaseType.UNLOADING: ("2-seal-verify", "4-visual-count"),
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-pod-signature", "3-reconciliation", "4-closed"),
}
