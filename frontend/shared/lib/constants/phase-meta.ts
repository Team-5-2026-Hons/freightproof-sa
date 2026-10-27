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

export const STEP_SLUGS: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['2-verification'],
  loading: ['1-linehaul'],
  departure: ['2-capture-seal', '4-departure'],
  in_transit: [],
  arrival: ['2-seal-verify'],
  unloading: ['4-visual-count'],
  confirmation: ['1-pod-photo', '2-receiver-handover', '3-reconciliation', '4-closed'],
}

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

export const ANCHORED_PHASES: readonly PhaseType[] = Object.keys(PHASE_NAMES) as PhaseType[]

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

export const EVIDENCE_ROLE_NOUN: Record<EvidenceRole, string> = {
  linehaul_photo: 'linehaul sheet photo',
  linehaul_pdf: 'linehaul sheet scan (PDF)',
  seal_photo: 'seal photo',
  waybill_photo: 'waybill photo',
  pod_photo: 'proof-of-delivery photo',
  pod_signature: 'receiver confirmation',
}
