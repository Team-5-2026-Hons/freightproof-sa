// Display names and driver step recipes per phase TYPE, not per phase instance — how many
// times a type occurs in a trip is DATA (generated at trip creation), only the recipe is
// static. Keying by type lets one plan contain `loading` twice (cross-dock case).

import type { EvidenceRole } from '@shared/lib/types/evidence'
import type { PhaseType } from '@shared/lib/types/phase'

export const PHASE_NAMES: Record<PhaseType, string> = {
  trip_creation: 'Trip Created',
  activation: 'Activation',
  loading: 'Loading',
  departure: 'Departure',
  in_transit: 'In Transit',
  arrival: 'Arrival',
  unloading: 'Unloading',
  confirmation: 'Confirmation',
}

// An empty recipe means no driver interaction. `loading` must stay non-empty: it's the
// only phase advance_loading (backend/app/orchestration/phase_service.py) can complete,
// and it requires driver_visual_count entered blind — no expected value shown.
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
  // The seal inspection moved here from unloading with its slug unchanged: the seal is
  // inspected as found, before the doors open, in a phase that must finish first.
  arrival: ['2-seal-verify'],
  unloading: ['4-visual-count'],
  confirmation: ['1-pod-photo', '2-receiver-handover', '3-reconciliation', '4-closed'],
}

// Positionally paired with STEP_SLUGS above — same length, same order, per phase.
export const STEP_NAMES: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['Verification'],
  loading: ['Linehaul'],
  departure: ['Capture Seal', 'Confirm Departure'],
  in_transit: [],
  arrival: ['Inspect Seal'],
  unloading: ['Visual Count'],
  confirmation: ['Photograph POD', 'Receiver Handover', 'Reconciliation', 'Trip Closed'],
}

// Which phases carry a Hedera anchor: all of them, since 2026-09-23.
// Mirrors backend phase_plan.ANCHORED_PHASES. P0 is fail-closed: a failed anchor rolls the
// whole trip back. Every other phase is fail-open: it completes and anchor_status records
// that a receipt is still owed. Derived from PHASE_NAMES (a Record over every PhaseType) so a
// new phase type is anchored by default rather than silently left out.
export const ANCHORED_PHASES: readonly PhaseType[] = Object.keys(PHASE_NAMES) as PhaseType[]

// Evidence roles a capture may be attributed to, per phase TYPE. Mirrored by
// backend/app/core/phase_meta.py; tests/unit/test_phase_meta_contract.py parses this block.
export const EVIDENCE_ROLES: Record<PhaseType, readonly EvidenceRole[]> = {
  trip_creation: [],
  activation: [],
  loading: ['linehaul_photo', 'linehaul_pdf'],
  departure: ['seal_photo', 'waybill_photo'],
  in_transit: [],
  arrival: ['seal_photo'],
  unloading: [],
  confirmation: ['pod_photo', 'pod_signature'],
}

// The phase column that records each role's submitted copy.
export const EVIDENCE_ROLE_FIELD: Record<
  EvidenceRole,
  | 'linehaul_photo_artifact_id'
  | 'linehaul_pdf_artifact_id'
  | 'seal_photo_artifact_id'
  | 'waybill_photo_artifact_id'
  | 'pod_photo_artifact_id'
  | 'pod_signature_artifact_id'
> = {
  linehaul_photo: 'linehaul_photo_artifact_id',
  linehaul_pdf: 'linehaul_pdf_artifact_id',
  seal_photo: 'seal_photo_artifact_id',
  waybill_photo: 'waybill_photo_artifact_id',
  pod_photo: 'pod_photo_artifact_id',
  pod_signature: 'pod_signature_artifact_id',
}

// Singular noun for "Expected: …" rows; never claims anything is missing.
export const EVIDENCE_ROLE_NOUN: Record<EvidenceRole, string> = {
  linehaul_photo: 'linehaul sheet photo',
  linehaul_pdf: 'linehaul sheet scan (PDF)',
  seal_photo: 'seal photo',
  waybill_photo: 'waybill photo',
  pod_photo: 'proof-of-delivery photo',
  pod_signature: 'receiver confirmation',
}
