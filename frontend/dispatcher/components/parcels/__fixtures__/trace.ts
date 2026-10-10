import type { ParcelJourney, ParcelTracePhase, ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import type { PhaseType } from '@shared/lib/types/phase'

export const BARCODE = '000123/a'
export const WAYBILL = 'WB-TRACE-01'

export function makePhase(kind: PhaseType, index: number): ParcelTracePhase {
  return {
    id: `phase-${index}`, sequence_number: index, phase_type: kind, status: 'completed',
    completed_at: '2026-10-07T22:30:00Z', driver_captured_at: null,
    precinct_id: 'precinct-1', precinct_name: 'Origin Depot', relevance: 'consignment',
    anchor_status: 'anchored', seal_number: null, seal_condition: null,
    location_verdict: 'unwitnessed', override_note: null,
  }
}

export function makeJourney(): ParcelJourney {
  const phases = [makePhase('loading', 0), makePhase('departure', 1), makePhase('in_transit', 2), makePhase('arrival', 3), makePhase('unloading', 4)]
  phases[1].seal_number = 'SEAL-001'
  phases[2] = { ...phases[2], status: 'pending', completed_at: null, anchor_status: 'pending' }
  phases[3] = { ...phases[3], status: 'pending', completed_at: null, anchor_status: 'pending', precinct_name: 'Destination Depot' }
  phases[4] = { ...phases[4], status: 'pending', completed_at: null, anchor_status: 'pending' }
  return {
    trip_id: 'trip-1', trip_reference: 'TRP-TRACE-01', trip_status: 'active', created_at: '2026-10-07T08:00:00Z',
    vehicle_registration: 'CA 123456', membership_source: 'current_assignment',
    origin_name: 'Origin Depot', destination_name: 'Destination Depot',
    progress: { position: 'within_journey', phase_event_id: 'phase-2', phase_type: 'in_transit', phase_status: 'pending', has_overrides: false },
    last_recorded_location: { phase_event_id: 'phase-1', precinct_name: 'Origin Depot', source: 'horse_tracker', captured_at: null, phase_completed_at: '2026-10-07T22:30:00Z', precinct_confirmed: true },
    scans: [{ parcel_id: 'parcel-1', status: 'scanned_out', scan_out_at: '2026-10-07T22:00:00Z', scan_in_at: null, source: 'parcel_record_source_unknown' }],
    phases,
    seal_windows: [{ departure_phase_id: 'phase-1', inspection_phase_id: 'phase-3', phase_ids: ['phase-1', 'phase-2', 'phase-3'], origin_name: 'Origin Depot', destination_name: 'Destination Depot', departure_seal: 'SEAL-001', arrival_seal: null, status: 'pending' }],
    exceptions: [], gaps: ['No destination parcel scan is recorded. A missing scan is an evidence gap, not proof of loss.'],
  }
}

export function makeTrace(): ParcelTraceResponse {
  return { barcode: BARCODE, waybill_reference: WAYBILL, journeys: [makeJourney()], next_cursor: null, coverage_note: 'History is derived from recorded phase events and retained cargo associations.' }
}
