// Display names and driver step recipes per phase TYPE, not per phase instance — how many
// times a type occurs in a trip is DATA (generated at trip creation), only the recipe is
// static. Keying by type lets one plan contain `loading` twice (cross-dock case).

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

// An empty recipe means no driver interaction. `loading` must stay non-empty: it's the
// only phase advance_loading (backend/app/orchestration/phase_service.py) can complete,
// and it requires driver_visual_count entered blind — no expected value shown, per F1.
//
// Slug numbers are ordering prefixes, not indices — do not renumber surviving slugs,
// that would break deep links and stored draft keys.
//
// Mirrored by backend/app/core/phase_meta.py; tests/unit/test_phase_meta_contract.py
// parses this file and fails if the two disagree.
export const STEP_SLUGS: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['2-verification'],
  loading: ['1-linehaul'],
  departure: ['2-capture-seal', '4-departure'],
  in_transit: [],
  unloading: ['2-seal-verify', '4-visual-count'],
  confirmation: ['1-pod-photo', '2-receiver-handover', '3-reconciliation', '4-closed'],
}

// Positionally paired with STEP_SLUGS above — same length, same order, per phase.
export const STEP_NAMES: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['Verification'],
  loading: ['Linehaul'],
  departure: ['Capture Seal', 'Confirm Departure'],
  in_transit: [],
  unloading: ['Verify Seal', 'Visual Count'],
  confirmation: ['Photograph POD', 'Receiver Handover', 'Reconciliation', 'Trip Closed'],
}

// Which phases carry a Hedera anchor, and under which failure policy — parent plan D7.
// P0 is fail-closed: a failed anchor rolls the whole trip back. P3/P6 are fail-open: the
// phase completes and anchor_status records that a receipt is still owed.
export const ANCHORED_PHASES: readonly PhaseType[] = ['trip_creation', 'departure', 'confirmation']
