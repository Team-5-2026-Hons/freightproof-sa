/**
 * Types for the dev trigger panel. Mirrors backend/app/schemas/dev.py. Dispatcher-local,
 * not @shared, since the driver surface never sees parcel-grain scan data.
 * CLOSED_PHASE_STATUSES is the exception (phase-domain, imported by
 * LoadingDetail/UnloadingDetail); move it to @shared/lib/types/phase if a third consumer appears.
 */

export type ScanDirection = 'out' | 'in'

/**
 * Phase statuses that mean a phase has already been decided and won't accept a further
 * scan-driven gate change. Mirrors CLOSED_PHASE_STATUSES in backend/app/schemas/dev.py —
 * keep in sync by hand. Also governs LoadingDetail/UnloadingDetail's "has this phase's
 * parcel_count_* been stamped" test.
 */
export const CLOSED_PHASE_STATUSES = ['completed', 'exception', 'overridden'] as const

export type ClosedPhaseStatus = (typeof CLOSED_PHASE_STATUSES)[number]

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
  // Status of the phase event gating each scan direction AT THIS STOP. Null = no
  // such phase event yet.
  loading_phase_status: string | null
  confirmation_phase_status: string | null
  // Status of the DEPARTURE phase for the leg ending at this stop; null when no
  // departure precedes this stop (i.e. it is the origin).
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
  // parcel_perfect_reference -> barcodes to stage. A waybill absent from the map
  // stages an EMPTY scan, not a full one (see MockScanFeed.stage_scans).
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

/** Exception types the panel offers — a deliberate subset of the backend enum with a
 *  demo narrative. Scan discrepancies are raised by the reconciliation service, not here. */
export const DEMO_EXCEPTION_TYPES = [
  'seal_broken_in_transit',
  'panic_button',
  'cargo_damage',
  'delivery_refused',
  'mechanical',
  'route_deviation',
] as const

export type DemoExceptionType = (typeof DEMO_EXCEPTION_TYPES)[number]

/** One preset mock-tracker fix ("waypoint"). Mirrors WaypointRead in
 *  backend/app/schemas/dev.py. Lat/lng are strings (backend serialises Decimal that
 *  way) — never coerce to number, or float rounding drifts the coordinate. */
export interface WaypointRead {
  waypoint_id: string
  label: string
  sequence: number
  description: string
  latitude: string | null
  longitude: string | null
  intended_distance_metres: number | null
  expected_confirmed: boolean | null
}

export interface MoveTruckRequest {
  trip_id: string
  waypoint_id: string
}

export interface MoveTruckResponse {
  trip_id: string
  waypoint_id: string
  waypoint_label: string
  device_id: string
  vehicle_registration: string
  precinct_id: string
  precinct_name: string
  latitude: string | null
  longitude: string | null
  has_position: boolean
  distance_metres: number | null
  geofence_radius_metres: number | null
  gps_tolerance_metres: number
  // null (not false) on the no_signal waypoint: no fix means no verdict was computed.
  geofence_confirmed: boolean | null
  in_tolerance_band: boolean
  verdict_reason: string
}

/** The waypoint_id that resets the mock tracker to sit at the precinct. */
export const PRECINCT_WAYPOINT_ID = 'precinct'
