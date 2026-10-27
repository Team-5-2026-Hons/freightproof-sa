import type { ParcelJourney, ParcelScanObservation, ParcelTraceException, ParcelTracePhase, ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
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

export const MISSING_SCAN_GAP = 'No destination parcel scan is recorded. A missing scan is an evidence gap, not proof of loss.'
export const MANIFEST_GAP = 'This barcode appears in the creation manifest. Planned membership does not prove it was loaded.'
export const BOUNDARIES_GAP = 'The historical pickup/delivery boundaries are unavailable; phases are shown as trip context.'

export function makeScan(index: number, overrides: Partial<ParcelScanObservation> = {}): ParcelScanObservation {
  return { parcel_id: `parcel-${index}`, status: 'scanned_out', scan_out_at: '2026-10-07T22:00:00Z', scan_in_at: null, source: 'parcel_record_source_unknown', ...overrides }
}

export function makeException(index: number, overrides: Partial<ParcelTraceException> = {}): ParcelTraceException {
  return { id: `exception-${index}`, phase_event_id: null, exception_type: 'seal_mismatch', severity: 'high', description: `Recorded exception ${index}`, recorded_at: '2026-10-07T23:00:00Z', scope: 'consignment', review_status: 'needs_review', ...overrides }
}

export function makeJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
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
    exceptions: [], gaps: [MISSING_SCAN_GAP],
    ...overrides,
  }
}

/**
 * Three-stop cross-dock ledger: loading, departure, in_transit and arrival each occur twice, with
 * two sealed custody legs. Mixed relevance, an override, a failed and a pending anchor, and one
 * phase per location verdict so presentation rules can be asserted without a live trip.
 */
export function makeMultiStopJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const kinds: PhaseType[] = ['trip_creation', 'activation', 'loading', 'departure', 'in_transit', 'arrival', 'loading', 'departure', 'in_transit', 'arrival', 'unloading', 'confirmation']
  const phases = kinds.map((kind, index) => makePhase(kind, index))
  phases[2] = { ...phases[2], location_verdict: 'confirmed' }
  phases[3] = { ...phases[3], seal_number: 'SEAL-A', location_verdict: 'unwitnessed' }
  phases[4] = { ...phases[4], anchor_status: 'pending' }
  phases[5] = { ...phases[5], status: 'exception', anchor_status: 'failed', location_verdict: 'mismatch', precinct_name: 'Cross-dock B' }
  phases[6] = { ...phases[6], relevance: 'trip_context', precinct_name: 'Cross-dock B' }
  phases[7] = { ...phases[7], seal_number: 'SEAL-B', precinct_name: 'Cross-dock B' }
  phases[8] = { ...phases[8], relevance: 'unknown' }
  phases[9] = { ...phases[9], status: 'overridden', override_note: 'Arrival accepted by dispatcher', precinct_name: 'Destination Depot' }
  phases[10] = { ...phases[10], status: 'pending', completed_at: null, anchor_status: 'pending' }
  phases[11] = { ...phases[11], status: 'pending', completed_at: null, anchor_status: 'pending' }
  return makeJourney({
    phases,
    seal_windows: [
      { departure_phase_id: 'phase-3', inspection_phase_id: 'phase-5', phase_ids: ['phase-3', 'phase-4', 'phase-5'], origin_name: 'Origin Depot', destination_name: 'Cross-dock B', departure_seal: 'SEAL-A', arrival_seal: 'SEAL-A', status: 'matched' },
      { departure_phase_id: 'phase-7', inspection_phase_id: 'phase-9', phase_ids: ['phase-7', 'phase-8', 'phase-9'], origin_name: 'Cross-dock B', destination_name: 'Destination Depot', departure_seal: 'SEAL-B', arrival_seal: null, status: 'unverified' },
    ],
    progress: { position: 'within_journey', phase_event_id: 'phase-10', phase_type: 'unloading', phase_status: 'pending', has_overrides: true },
    exceptions: [makeException(1, { phase_event_id: 'phase-5' })],
    ...overrides,
  })
}

export const WAY_SCAN_OUT_AT = '2026-10-15T09:58:00Z'
export const WAY_DEPARTURE_AT = '2026-10-15T10:10:00Z'

/**
 * Shaped like the live WAY0020001 trace: a single-leg trip cancelled after departure. Trip creation,
 * activation, loading and departure are recorded; the seal is still pending inspection; in transit,
 * arrival, unloading and confirmation were never reached. Activation, loading and departure carry three
 * exceptions each (two types between them), one cancellation exception has no phase and is already
 * reviewed, and the parcel was scanned out but never scanned in.
 */
export function makeWayJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const kinds: PhaseType[] = ['trip_creation', 'activation', 'loading', 'departure', 'in_transit', 'arrival', 'unloading', 'confirmation']
  const phases: ParcelTracePhase[] = kinds.map((kind, index) => ({ ...makePhase(kind, index), completed_at: '2026-10-15T09:30:00Z', precinct_name: 'Origin Depot' }))
  phases[3] = { ...phases[3], completed_at: WAY_DEPARTURE_AT, seal_number: 'SEAL-WAY' }
  for (const index of [0, 1]) phases[index] = { ...phases[index], relevance: 'trip_context' }
  for (const index of [4, 5, 6, 7]) phases[index] = { ...phases[index], status: 'pending', completed_at: null, anchor_status: 'pending' }
  const exceptions = [
    makeException(1, { phase_event_id: 'phase-1', exception_type: 'tracker_silent', review_status: 'needs_review' }),
    makeException(2, { phase_event_id: 'phase-1', exception_type: 'tracker_silent', review_status: 'needs_review' }),
    makeException(3, { phase_event_id: 'phase-1', exception_type: 'tracker_silent', review_status: 'needs_review' }),
    makeException(4, { phase_event_id: 'phase-2', exception_type: 'gps_mismatch', review_status: 'needs_review' }),
    makeException(5, { phase_event_id: 'phase-2', exception_type: 'gps_mismatch', review_status: 'needs_review' }),
    makeException(6, { phase_event_id: 'phase-2', exception_type: 'gps_mismatch', review_status: 'recorded' }),
    makeException(7, { phase_event_id: 'phase-3', exception_type: 'gps_mismatch', review_status: 'needs_review' }),
    makeException(8, { phase_event_id: 'phase-3', exception_type: 'gps_mismatch', review_status: 'recorded' }),
    makeException(9, { phase_event_id: 'phase-3', exception_type: 'gps_mismatch', review_status: 'recorded' }),
    makeException(10, { phase_event_id: null, exception_type: 'trip_cancelled', scope: 'trip_context', review_status: 'reviewed' }),
  ]
  return makeJourney({
    trip_status: 'cancelled',
    phases,
    progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false },
    last_recorded_location: { phase_event_id: 'phase-3', precinct_name: 'Origin Depot', source: 'horse_tracker', captured_at: '2026-10-15T10:09:00Z', phase_completed_at: WAY_DEPARTURE_AT, precinct_confirmed: true },
    scans: [makeScan(1, { scan_out_at: WAY_SCAN_OUT_AT })],
    seal_windows: [{ departure_phase_id: 'phase-3', inspection_phase_id: 'phase-5', phase_ids: ['phase-3', 'phase-4', 'phase-5'], origin_name: 'Origin Depot', destination_name: 'Destination Depot', departure_seal: 'SEAL-WAY', arrival_seal: null, status: 'pending' }],
    exceptions,
    ...overrides,
  })
}

export const DELIVERED_SCAN_IN_AT = '2026-10-16T08:00:00Z'

/**
 * A single-leg trip whose every consignment phase is recorded, whose seals matched, and whose parcel was scanned
 * in at the destination. Location verdicts are confirmed so no step carries an issue pill. The type says "delivered"
 * only in this name: the page must never use that word for a recorded confirmation phase or a scan.
 */
export function makeDeliveredJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const kinds: PhaseType[] = ['trip_creation', 'activation', 'loading', 'departure', 'in_transit', 'arrival', 'unloading', 'confirmation']
  const phases: ParcelTracePhase[] = kinds.map((kind, index) => ({ ...makePhase(kind, index), location_verdict: 'confirmed' }))
  for (const index of [0, 1]) phases[index] = { ...phases[index], relevance: 'trip_context' }
  phases[3] = { ...phases[3], seal_number: 'SEAL-DEL' }
  phases[5] = { ...phases[5], precinct_name: 'Destination Depot' }
  phases[6] = { ...phases[6], precinct_name: 'Destination Depot' }
  phases[7] = { ...phases[7], precinct_name: 'Destination Depot' }
  return makeJourney({
    trip_status: 'closed',
    phases,
    progress: { position: 'after_delivery', phase_event_id: 'phase-7', phase_type: 'confirmation', phase_status: 'completed', has_overrides: false },
    scans: [makeScan(1, { scan_in_at: DELIVERED_SCAN_IN_AT, status: 'scanned_in' })],
    seal_windows: [{ departure_phase_id: 'phase-3', inspection_phase_id: 'phase-5', phase_ids: ['phase-3', 'phase-4', 'phase-5'], origin_name: 'Origin Depot', destination_name: 'Destination Depot', departure_seal: 'SEAL-DEL', arrival_seal: 'SEAL-DEL', status: 'matched' }],
    exceptions: [], gaps: [],
    ...overrides,
  })
}

/** Delivered shape, but the arrival was overridden by a dispatcher rather than attested: an override is not an arrival. */
export function makeOverriddenArrivalJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const journey = makeDeliveredJourney()
  const phases = journey.phases.map(phase => phase.phase_type === 'arrival' ? { ...phase, status: 'overridden' as const, override_note: 'Arrival accepted by dispatcher' } : phase)
  return { ...journey, phases, progress: { ...journey.progress, has_overrides: true }, ...overrides }
}

/** A recorded departure whose relevance the backend could not determine. */
export function makeUnknownRelevanceJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const journey = makeWayJourney()
  const phases = journey.phases.map(phase => phase.phase_type === 'departure' ? { ...phase, relevance: 'unknown' as const } : phase)
  return { ...journey, phases, ...overrides }
}

/** The latest journey is only a creation-manifest association: planned membership, not proof of loading. */
export function makeManifestOnlyJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  return makeJourney({ membership_source: 'creation_manifest', gaps: [MANIFEST_GAP, MISSING_SCAN_GAP], ...overrides })
}

/**
 * The backend could not find the consignment's pickup/delivery boundaries, so it marks every phase trip_context
 * (projection.py). No phase is attributed to the parcel; only its scan and the API's gaps remain.
 */
export function makeBoundariesUnavailableJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  const journey = makeJourney()
  return {
    ...journey,
    phases: journey.phases.map(phase => ({ ...phase, relevance: 'trip_context' as const })),
    seal_windows: [], last_recorded_location: null,
    progress: { position: 'unknown', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false },
    gaps: [BOUNDARIES_GAP, MISSING_SCAN_GAP],
    ...overrides,
  }
}

export function makeTrace(journeys: ParcelJourney[] = [makeJourney()]): ParcelTraceResponse {
  return { barcode: BARCODE, waybill_reference: WAYBILL, journeys, next_cursor: null, coverage_note: 'History is derived from recorded phase events and retained cargo associations.' }
}
