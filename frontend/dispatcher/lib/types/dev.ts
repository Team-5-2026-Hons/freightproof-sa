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
  loading_phase_status: string | null
  confirmation_phase_status: string | null
  preceding_departure_status: string | null
  arrival_phase_status: string | null
  unloading_phase_status: string | null
}

/** One vehicle on the trip, so the panel can offer a per-trailer scenario. */
export interface DevVehicle {
  vehicle_id: string
  registration: string
  role: 'horse' | 'trailer'
}

export interface DevTripSummary {
  trip_id: string
  trip_reference: string
  status: string
  current_phase: string | null
  driver_full_name: string | null
  created_at: string
  stops: DevTripStop[]
  current_stop_sequence: number | null
  vehicles: DevVehicle[]
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

export const DEMO_EXCEPTION_TYPES = [
  'seal_broken_in_transit',
  'panic_button',
  'cargo_damage',
  'delivery_refused',
  'mechanical',
  'route_deviation',
] as const

export type DemoExceptionType = (typeof DEMO_EXCEPTION_TYPES)[number]

/**
 * One preset mock-tracker fix ("waypoint"). Mirrors WaypointRead in
 * backend/app/schemas/dev.py. Latitude/longitude are strings because the
 * backend serialises Decimal that way — never coerce them to number, since
 * float rounding on a coordinate is exactly the kind of drift this endpoint
 * exists to test.
 */
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

export const DEV_TRUCK_SCENARIOS = [
  'at_stop',
  'inside_tolerance',
  'outside_tolerance',
  'three_km',
  'fifty_km',
  'no_signal',
] as const

export type DevTruckScenario = (typeof DEV_TRUCK_SCENARIOS)[number]

export const SCENARIO_LABELS: Record<DevTruckScenario, string> = {
  at_stop: 'At the stop',
  inside_tolerance: 'Just inside tolerance',
  outside_tolerance: 'Just outside tolerance',
  three_km: '3 km from the stop',
  fifty_km: '50 km from the stop',
  no_signal: 'Go dark (no signal)',
}

export const NO_STOP_REQUIRED_SCENARIO: DevTruckScenario = 'no_signal'

export interface MoveTruckRequest {
  trip_id: string
  waypoint_id?: string
  scenario?: DevTruckScenario
  trip_stop_id?: string
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
  geofence_confirmed: boolean | null
  in_tolerance_band: boolean
  verdict_reason: string

  target_trip_stop_id: string | null
  target_precinct_name: string | null
  target_distance_metres: number | null
  scenario: DevTruckScenario | null

  expected_trip_stop_id: string | null
  expected_precinct_name: string | null
}

export const PRECINCT_WAYPOINT_ID = 'precinct'

export const RIG_SCENARIOS = [
  'at_stop', 'away_from_stop', 'en_route', 'left_before_departure', 'trailer_uncoupled', 'silent',
] as const
export type RigScenario = (typeof RIG_SCENARIOS)[number]

export interface RigScenarioRequest {
  trip_id: string
  scenario: RigScenario
  trip_stop_id?: string
  vehicle_id?: string
}

export interface RigReadingRead {
  vehicle_id: string
  registration: string
  role: 'horse' | 'trailer'
  status: string
  latitude: string | null
  longitude: string | null
}

export interface RoadFindingRead {
  exception_type: string
  severity: string
  vehicle_id: string
  description: string
  newly_recorded: boolean
}

export interface RoadCheckResponse {
  trip_id: string
  readings: RigReadingRead[]
  findings: RoadFindingRead[]
  skipped_reason: string | null
}

export interface RigScenarioResponse extends RoadCheckResponse {
  scenario: RigScenario
  label: string
}

export const PHONE_PLACEMENTS = ['at_origin', 'at_destination', 'at_stop', 'release'] as const

export type DevPhonePlacement = (typeof PHONE_PLACEMENTS)[number]

export const STOP_REQUIRED_PLACEMENT: DevPhonePlacement = 'at_stop'

export const PHONE_PLACEMENT_LABELS: Record<DevPhonePlacement, string> = {
  at_origin: 'Phone at origin',
  at_destination: 'Phone at destination',
  at_stop: 'Phone at this stop',
  release: "Use the phone's real location",
}

export interface MovePhoneRequest {
  trip_id: string
  placement: DevPhonePlacement
  trip_stop_id?: string
}

export interface MovePhoneResponse {
  trip_id: string
  placement: DevPhonePlacement
  placement_label: string
  staged: boolean
  latitude: string | null
  longitude: string | null
  trip_stop_id: string | null
  precinct_name: string | null
  recorded_as: string
}
