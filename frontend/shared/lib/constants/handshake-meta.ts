import type { HandshakeNumber } from '@shared/lib/types/handshake'

export const HANDSHAKE_NAMES: Record<HandshakeNumber, string> = {
  0: 'Trip Created',
  1: 'Origin Gate-In',
  2: 'Loading',
  3: 'Origin Gate-Out',
  4: 'Destination Gate-In',
  5: 'Unloading',
}

// Number of driver-facing steps per handshake. H0 is dispatcher-only — 0 driver steps.
export const HANDSHAKE_STEP_COUNTS: Record<HandshakeNumber, number> = {
  0: 0,
  1: 3,
  2: 5,
  3: 3,
  4: 3,
  5: 6,
}

// URL step slugs — must match spec §8 page catalogue exactly.
export const STEP_SLUGS: Record<1 | 2 | 3 | 4 | 5, string[]> = {
  1: ['1-approach-gate', '2-entry-photo', '3-verification'],
  2: ['1-arrive-bay', '2-manifest', '3-waybill', '4-seal', '5-review'],
  3: ['1-approach-exit', '2-exit-and-seal', '3-departure'],
  4: ['1-approach-dest', '2-dest-entry-photo', '3-seal-verify'],
  5: ['1-hand-waybill', '2-seal-break-inspection', '3-visual-count', '4-pod-photo', '5-reconciliation', '6-closed'],
}

export const STEP_NAMES: Record<1 | 2 | 3 | 4 | 5, string[]> = {
  1: ['Gate Arrival', 'Entry Photo', 'Verification'],
  2: ['Arrive at Bay', 'Confirm Manifest', 'Photograph Waybill', 'Capture Seal', 'Review & Submit'],
  3: ['Approach Exit Gate', 'Exit Photo & Seal', 'Confirm Departure'],
  4: ['Destination Gate Arrival', 'Entry Photo', 'Seal Verification'],
  5: ['Hand Waybill Copy', 'Wait for Inspection', 'Visual Count', 'Photograph POD', 'Reconciliation', 'Trip Closed'],
}
