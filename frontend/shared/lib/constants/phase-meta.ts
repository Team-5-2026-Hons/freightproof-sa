// Display names and driver step recipes per phase TYPE.
//
// Replaces constants/handshake-meta.ts, whose Record<0|1|2|3|4|5, ...> and
// HANDSHAKE_STEP_COUNTS encode the fixed-length assumption in literal form. Nothing here
// may acquire an equivalent: how many times each phase type occurs in a trip is DATA,
// generated at trip creation. Only the recipe for a given type is static.
//
// Keying by type rather than by index is precisely what allows one plan to contain
// `loading` twice — the cross-dock case the whole refactor exists to support.

import type { PhaseType } from '@shared/lib/types/phase'

export const PHASE_NAMES: Record<PhaseType, string> = {
  trip_creation: 'Trip Created',
  activation: 'Activation',
  loading: 'Loading',
  departure: 'Departure',
  in_transit: 'In Transit',
  unloading: 'Unloading',
  confirmation: 'Confirmation',
}

// An empty recipe means no driver interaction:
//   trip_creation — dispatcher-side, before the driver is involved at all.
//   loading       — NOT empty (below). advance_loading (orchestration/phase_service.py)
//                   requires driver_visual_count and is the only entry point in the
//                   phase dispatch table that can complete this phase, so an empty
//                   recipe here would make `loading` uncompletable. advance_confirmation
//                   later reads that stored count as origin_count for its three-way
//                   reconciliation verdict. The driver enters this count BLIND — no
//                   expected value, no Parcel Perfect figure, no mismatch banner — which
//                   is what F1 actually requires: it forbids showing the driver an
//                   expected count, not the driver entering their own.
//
// The three GPS-capture steps are gone (2026-08-05): activation's '1-approach-gate',
// departure's '1-approach-exit', and in_transit's '1-arrival' each existed only to make
// the driver tap "Capture GPS Location" behind a swipe gate — and in_transit's fix was
// never even sent to the server. The driver app now takes the fix silently as each phase
// is confirmed, and records a continuous per-trip trail besides, so position is captured
// more often than before with no step to walk. Surviving slugs keep their original
// numbers: the prefix orders this list, it is not an index, and renumbering would break
// every deep link and stored draft key for no visible gain.
//
// unloading's '3-seal-break-inspection' is gone for the same reason (2026-08-05): it
// photographed the seal AFTER the warehouse broke it, which proves nothing about the
// journey. The tamper-evidence bookend is departure's seal photo plus the INTACT photo
// captured on '2-seal-verify'; the broken-seal shot was never even sent (lib/api/
// phases.ts sends only the intact one, as gate_photo_artifact_id). Surviving slugs keep
// their numbers here too, for the same reason.
//
// Mirrored by backend/app/core/phase_meta.py — tests/unit/test_phase_meta_contract.py
// parses THIS file and fails if the two disagree.
export const STEP_SLUGS: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['2-verification'],
  loading: ['1-linehaul'],
  // departure's '3-waybill' is gone (2026-08-10): it photographed the LINEHAUL DOCUMENT,
  // the same physical sheet the driver already photographs on loading's '1-linehaul'.
  // Asking for it twice cost the driver a second capture and produced two artifacts of
  // one document with no way to tell which the evidence chain should cite. Loading is
  // the honest place for it — that is where the warehouse hands the sheet over — and the
  // dispatcher already reads it from there (LoadingDetail.tsx, linehaul_photo_artifact_id).
  // DepartureCompleteRequest.waybill_photo_artifact_id is now Optional server-side rather
  // than deleted, so departures queued offline by an older build still drain.
  // Surviving slugs keep their numbers, per the note above.
  departure: ['2-capture-seal', '4-departure'],
  in_transit: [],
  // Seal photo FIRST (2026-08-08) — the intact seal is the only evidence at this stop
  // that expires the moment the truck is opened. '1-hand-waybill' is gone: it sent
  // nothing to the server (UnloadingCompleteRequest takes only the seal number and
  // photo), so dropping it loses no evidence. Surviving slugs keep their numbers, per
  // the note above. Mirrored by backend/app/core/phase_meta.py — the contract test
  // parses THIS file, so the two must change together.
  unloading: ['2-seal-verify', '4-visual-count'],
  confirmation: ['1-pod-photo', '2-pod-signature', '3-reconciliation', '4-closed'],
}

// Positionally paired with STEP_SLUGS above — same length, same order, per phase.
export const STEP_NAMES: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['Verification'],
  loading: ['Linehaul'],
  // 'Photograph Linehaul Document' is gone with '3-waybill' above — the linehaul sheet is
  // captured once, on loading. Departure is now seal, then confirm.
  departure: ['Capture Seal', 'Confirm Departure'],
  in_transit: [],
  unloading: ['Verify Seal', 'Visual Count'],
  confirmation: ['Photograph POD', 'Capture Signature', 'Reconciliation', 'Trip Closed'],
}

// Which phases carry a Hedera anchor, and under which failure policy — parent plan D7.
// P0 is fail-closed: a failed anchor rolls the whole trip back. P3/P6 are fail-open: the
// phase completes and anchor_status records that a receipt is still owed.
export const ANCHORED_PHASES: readonly PhaseType[] = ['trip_creation', 'departure', 'confirmation']
