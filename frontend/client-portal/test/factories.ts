// Minimal manifest builders for component and helper tests. Defaults describe a closed,
// uneventful trip; each test overrides only what it is about.
import type {
  AnchoredRecord,
  AuditPackManifest,
  ExceptionRecord,
  IncidentSummary,
  InvestigationRecord,
  LateEvidenceRecord,
  PhaseRecord,
  PublicAuditPackView,
  PublicPackSeal,
  CheckpointRecord,
  StopRecord,
} from '@/lib/types'
import { sha256Hex } from '@/lib/verify'

const T0 = '2026-09-12T06:00:00Z'

export function makePhase(seq: number, phaseType: string, overrides: Partial<PhaseRecord> = {}): PhaseRecord {
  return {
    phase_event_id: `phase-${seq}`, sequence_number: seq, phase_type: phaseType, status: 'completed',
    anchor_status: 'not_required', trip_stop_id: null, precinct_name: null, slot_time: null,
    completed_at: `2026-09-12T${String(6 + seq).padStart(2, '0')}:00:00Z`, driver_captured_at: null, driver_phone: null,
    vehicle_tracker: null, trailer_fixes: [], location_assessment: null, location_warning_acknowledged_at: null,
    location_warning_reason: null, overridden_by_dispatcher: false, override_note: null, seal_number: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null, evidence: [],
    anchored_fields: [], anchor_receipt_id: null, tier: 'recorded', ...overrides,
  }
}

export function makeException(type: string, severity: string, overrides: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return {
    exception_id: `exc-${type}`, exception_type: type, source: 'driver', severity, description: 'd',
    raised_at: '2026-09-12T11:00:00Z', position: null, phase_event_id: null, checkpoint_id: null,
    consignment_id: null, review_status: 'recorded', review_outcome: null, reviewed_at: null,
    reviewer_name: null, contact_method: null, review_note: null, evidence: [], tier: 'recorded', ...overrides,
  }
}

export function makeCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    checkpoint_id: 'cp-1', checkpoint_type: 'rest_stop', recorded_at: '2026-09-12T10:00:00Z',
    driver_phone: null, vehicle_tracker: null, is_deviation: false, note: null, evidence: [], tier: 'recorded',
    ...overrides,
  }
}

export function makeManifest(overrides: Partial<AuditPackManifest> = {}): AuditPackManifest {
  return {
    manifest_version: 1, generated_at: '2026-09-13T06:00:00Z',
    options: { scope_consignment_id: null, include_location_trail: true, include_full_driver_id: false },
    trip: {
      trip_id: 'trip-1', trip_reference: 'FP-AUDIT', order_number: 'ORD-77', trip_type: 'loaded', status: 'closed',
      operator_name: 'Load Factor', client_names: ['FedEx'], pulsit_trip_reference_id: null, journey_lock_hash: null,
      created_at: T0, planned_departure_at: null, planned_arrival_at: null, actual_departure_at: null,
      actual_arrival_at: null, closed_at: '2026-09-12T15:00:00Z',
    },
    stops: [], vehicles: [],
    driver: {
      driver_id: 'd-1', full_name: 'Sipho Driver', id_number: '*********9087', id_number_masked: true,
      license_number: 'DRV-1', license_expiry: null, license_valid_on_trip_date: null, trip_idvs_status: 'verified',
      trip_idvs_checked_at: null, substitutions: [],
    },
    consignments: [], phases: [], checkpoints: [], exceptions: [], record_changes: [], location_trail: [],
    location_coverage: {
      window_start: null, window_end: null, fix_counts: {}, first_fix_at: null, last_fix_at: null, gaps: [],
      stationary_periods: [],
    },
    anchored_records: [], incident: null, observations: [], redactions: [], ...overrides,
  }
}

export function makeView(manifest: AuditPackManifest = makeManifest()): PublicAuditPackView {
  return {
    seal: {
      pack_id: 'pack-1', pack_label: 'FP-AUDIT-AP1', issued_at: '2026-09-13T06:00:00Z',
      expires_at: '2026-10-13T06:00:00Z', revoked: false, anchor_status: 'anchored', manifest_sha256: 'ab'.repeat(32),
      pdf_sha256: 'cd'.repeat(32), seal: null, hedera_network: 'testnet',
      mirror_base_url: 'https://testnet.mirrornode.hedera.com',
    },
    recipient_name: 'Jane Adjuster', recipient_organization: 'Santam Claims', purpose: 'insurance_claim',
    external_reference: 'CLM-88123', manifest,
  }
}

export function makeStop(sequence: number, overrides: Partial<StopRecord> = {}): StopRecord {
  return {
    trip_stop_id: `stop-${sequence}`, sequence, precinct_id: `precinct-${sequence}`, precinct_name: `Depot ${sequence}`,
    address: null, lat: -26.2 - sequence * 0.1, lng: 28.0 + sequence * 0.1, geofence_radius_metres: 300, slot_time: null,
    ...overrides,
  }
}

export function makeIncident(overrides: Partial<IncidentSummary> = {}): IncidentSummary {
  return {
    exception_ids: ['exc-panic_button'], first_exception_type: 'panic_button', first_raised_at: '2026-09-12T11:00:00Z',
    position: null, last_known_position: null, first_reviewed_at: null, minutes_to_first_review: null, ...overrides,
  }
}

export function makeInvestigation(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return {
    incident_id: 'inc-1', reference: 'INC-1', incident_type: 'hijacking', summary: 'Reported by phone',
    reporter_role: 'driver', report_channel: 'phone', reported_occurred_at: null, received_at: '2026-09-12T11:05:00Z',
    confidence: 'high', status: 'open', outcome: null, closure_reason: null, closed_at: null, trip_stopped_at: null,
    assigned_to_name: null, exception_ids: [], parcels: [], entries: [], tier: 'declared', ...overrides,
  }
}

export function makeLateEvidence(overrides: Partial<LateEvidenceRecord> = {}): LateEvidenceRecord {
  return {
    evidence_id: 'late-1', driver_name: 'Sipho Driver', custody_sequence: 1, kind: 'handover_photo',
    captured_at: '2026-09-12T08:00:00Z', received_at: '2026-09-12T09:00:00Z', status: 'retained',
    payload_sha256: 'ef'.repeat(32), photo_sha256: [], reviewed_at: null, ...overrides,
  }
}

/** An anchored record whose payload really hashes to its data_hash, so the browser check can verify it. */
export async function makeAnchoredRecord(sequence: number, overrides: Partial<AnchoredRecord> = {}): Promise<AnchoredRecord> {
  const payload = JSON.stringify({ receipt: sequence })
  return {
    receipt_id: `r-${sequence}`, subject_type: 'phase_event', subject_id: `s-${sequence}`, receipt_type: 'pickup',
    canonical_payload: payload, data_hash: await sha256Hex(payload), hedera_topic_id: '0.0.2002',
    hedera_sequence_number: sequence, hedera_tx_id: `0.0.1@${sequence}`, hedera_consensus_at: null,
    payload_matches_hash: true, ...overrides,
  }
}

/**
 * A pack seal that really commits to the view's own fingerprints. `payload` overrides fields of the
 * sealed JSON (to model a seal that disagrees with the page); `overrides` change the PublicPackSeal itself.
 */
export async function makeSealedSeal(
  payload: Record<string, unknown> = {},
  overrides: Partial<PublicPackSeal> = {},
): Promise<PublicPackSeal> {
  const base = makeView().seal
  const canonical = JSON.stringify({
    payload_version: 1, pack_id: base.pack_id, trip_id: 'trip-1', pack_version: 1,
    manifest_sha256: base.manifest_sha256, pdf_sha256: base.pdf_sha256, issued_at: base.issued_at, ...payload,
  })
  return {
    ...base,
    seal: {
      canonical_payload: canonical, data_hash: await sha256Hex(canonical), hedera_topic_id: '0.0.2002',
      hedera_sequence_number: 900, hedera_tx_id: '0.0.1@900', hedera_consensus_at: null,
    },
    ...overrides,
  }
}
