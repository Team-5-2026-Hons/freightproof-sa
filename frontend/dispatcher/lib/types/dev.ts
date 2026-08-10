/**
 * Types for the dev trigger panel. Mirrors backend/app/schemas/dev.py.
 *
 * Dispatcher-local rather than in @shared: the driver surface never sees
 * parcel-grain scan data, so the request/response contracts here have exactly one
 * consumer — the dev panel. CLOSED_PHASE_STATUSES below is the exception; it is
 * phase-domain, not dev-panel, and LoadingDetail/UnloadingDetail import it. If a
 * third consumer appears, move it to @shared/lib/types/phase and re-export here.
 */

export type ScanDirection = 'out' | 'in'

/**
 * Phase statuses that mean a phase has already been decided and will not accept
 * a further scan-driven gate change. Mirrors CLOSED_PHASE_STATUSES in
 * backend/app/schemas/dev.py — keep the two lists in sync by hand, since this
 * file has no import path back to the backend.
 *
 * Also reused by LoadingDetail/UnloadingDetail (components/domain) as the
 * governing test for "has this phase's stamped figure been written yet" — the
 * same set of statuses that means a scan gate is decided also means a phase's
 * parcel_count_* has been stamped and stops being read live.
 */
export const CLOSED_PHASE_STATUSES = ['completed', 'exception', 'overridden'] as const

export type ClosedPhaseStatus = (typeof CLOSED_PHASE_STATUSES)[number]

// Narrow helper so callers don't re-implement the `includes` check (and the
// null handling) at every call site.
export function isClosedPhaseStatus(status: string | null): boolean {
  return status !== null && (CLOSED_PHASE_STATUSES as readonly string[]).includes(status)
}

/** One waybill at a stop, with the real parcel barcodes under it. */
export interface DevConsignment {
  consignment_id: string
  parcel_perfect_reference: string
  barcodes: string[]
}

export interface DevTripStop {
  trip_stop_id: string
  sequence: number
  precinct_name: string
  pickup_consignments: DevConsignment[]
  delivery_consignments: DevConsignment[]
  // Status of the phase event gating each scan direction AT THIS STOP. None = no
  // such phase event yet. See CLOSED_PHASE_STATUSES for "already decided" values.
  loading_phase_status: string | null
  confirmation_phase_status: string | null
  // Status of the DEPARTURE phase for the leg that ends at this stop — the truck
  // physically leaving the origin is the precondition for any destination scan.
  // Null when no departure precedes this stop (i.e. it is the origin).
  preceding_departure_status: string | null
}

export interface DevTripSummary {
  trip_id: string
  trip_reference: string
  status: string
  current_phase: string | null
  driver_full_name: string | null
  created_at: string
  stops: DevTripStop[]
}

export interface ConsignmentScanResult {
  consignment_id: string
  parcel_perfect_reference: string
  expected_count: number
  observed_count: number
  matched_barcodes: string[]
  missing_barcodes: string[]
  unexpected_barcodes: string[]
  exception_ids: string[]
}

export interface ScanTriggerRequest {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  parcel_count?: number
  barcodes?: string[]
  // Per-waybill selection: parcel_perfect_reference -> the barcodes to stage for
  // it. A waybill absent from the map stages an EMPTY scan, not a full one — see
  // MockScanFeed.stage_scans's replace-not-append docstring. The panel always
  // sends every waybill's full ticked set for this reason.
  barcodes_by_reference?: Record<string, string[]>
}

export interface ScanTriggerResponse {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  consignments: ConsignmentScanResult[]
}

export interface CloseScanSessionRequest {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
}

export interface CloseScanSessionResponse {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  // One per consignment at the stop — a stop may serve several waybills.
  sessions_closed: number
}

export interface PpTriggerRequest {
  trip_id: string
  parcel_perfect_reference: string
  manifest?: number
  poddate?: string
  failtype?: string
  parcel_count?: number
}

export interface PpTriggerResponse {
  consignment_id: string
  parcel_perfect_reference: string
  parcel_count_expected: number | null
  pp_manifest_number: number | null
  poddate: string
  failtype: string | null
  warning: string | null
}

export interface ExceptionTriggerRequest {
  trip_id: string
  exception_type: string
  description: string
}

export interface ExceptionTriggerResponse {
  exception_id: string
  trip_id: string
  exception_type: string
  severity: string
  description: string
}

export interface FlushMockStateResponse {
  keys_deleted: number
}

/**
 * Exception types the panel offers. A deliberate subset of the backend enum —
 * the ones with a demo narrative. Scan discrepancies are raised by the
 * reconciliation service itself and are not in this list.
 */
export const DEMO_EXCEPTION_TYPES = [
  'seal_broken_in_transit',
  'panic_button',
  'cargo_damage',
  'delivery_refused',
  'mechanical',
  'route_deviation',
] as const

export type DemoExceptionType = (typeof DEMO_EXCEPTION_TYPES)[number]
