// Minimal manifest builders for component and helper tests. Defaults describe a closed,
// uneventful trip; each test overrides only what it is about.
import type {
  AuditPackManifest,
  ExceptionRecord,
  PhaseRecord,
  PublicAuditPackView,
  CheckpointRecord,
} from '@/lib/types'

export const T0 = '2026-09-12T06:00:00Z'

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
