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
export const STEP_SLUGS: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['1-approach-gate', '2-verification'],
  loading: ['1-visual-count'],
  departure: ['1-approach-exit', '2-capture-seal', '3-waybill', '4-departure'],
  in_transit: ['1-arrival'],
  unloading: ['1-hand-waybill', '2-seal-verify', '3-seal-break-inspection', '4-visual-count'],
  confirmation: ['1-pod-photo', '2-pod-signature', '3-reconciliation', '4-closed'],
}

export const STEP_NAMES: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['Gate Arrival', 'Verification'],
  loading: ['Visual Count'],
  departure: ['Approach Exit Gate', 'Capture Seal', 'Photograph Waybill', 'Confirm Departure'],
  in_transit: ['Arrival'],
  unloading: ['Hand Waybill Copy', 'Verify Seal', 'Wait for Inspection', 'Visual Count'],
  confirmation: ['Photograph POD', 'Capture Signature', 'Reconciliation', 'Trip Closed'],
}

// Which phases carry a Hedera anchor, and under which failure policy — parent plan D7.
// P0 is fail-closed: a failed anchor rolls the whole trip back. P3/P6 are fail-open: the
// phase completes and anchor_status records that a receipt is still owed.
export const ANCHORED_PHASES: readonly PhaseType[] = ['trip_creation', 'departure', 'confirmation']
