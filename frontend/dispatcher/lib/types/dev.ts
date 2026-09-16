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

/**
 * FP-197 (Task 3) — trip-stop-relative scenario mode, alongside the legacy fixed
 * waypoint mode above. Mirrors backend/app/schemas/dev.py's SCENARIO_* constants and
 * DevTruckScenario exactly — kept in sync by hand like CLOSED_PHASE_STATUSES above,
 * since this file has no import path back to the backend.
 */
export const DEV_TRUCK_SCENARIOS = [
  'at_stop',
  'inside_tolerance',
  'outside_tolerance',
  'three_km',
  'fifty_km',
  'no_signal',
] as const

export type DevTruckScenario = (typeof DEV_TRUCK_SCENARIOS)[number]

/**
 * Presentation labels for the scenario buttons, mirroring
 * orchestration/dev_truck_service.py's SCENARIO_LABELS. Needed client-side (not just
 * read off the response) because the buttons have to say something BEFORE the
 * operator presses one — the response's own waypoint_label only exists after a scenario
 * has already run.
 *
 * Deliberately spelled DIFFERENTLY from every legacy waypoint label
 * (WaypointRead.label, served by the backend for the "Fixed demo locations" grid):
 * both grids render on screen at the same time once a trip is selected, and two
 * differently-behaved buttons sharing identical visible text (e.g. two "No signal"
 * buttons) would be ambiguous for an operator and for a screen reader alike.
 */
export const SCENARIO_LABELS: Record<DevTruckScenario, string> = {
  at_stop: 'At the stop',
  inside_tolerance: 'Just inside tolerance',
  outside_tolerance: 'Just outside tolerance',
  three_km: '3 km from the stop',
  fifty_km: '50 km from the stop',
  no_signal: 'Go dark (no signal)',
}

// The one scenario that may fire without a trip stop selected — going dark is not a
// coordinate offset from anywhere. Named so call sites never re-spell the literal.
export const NO_STOP_REQUIRED_SCENARIO: DevTruckScenario = 'no_signal'

export interface MoveTruckRequest {
  trip_id: string
  // Exactly one of waypoint_id or scenario is sent — mirrors MoveTruckRequest's own
  // model validator in backend/app/schemas/dev.py, which 422s otherwise.
  waypoint_id?: string
  scenario?: DevTruckScenario
  // Required unless scenario is 'no_signal', which may omit it (going dark is not a
  // coordinate offset from a stop). Never sent alongside waypoint_id.
  trip_stop_id?: string
}

export interface MoveTruckResponse {
  trip_id: string
  waypoint_id: string
  waypoint_label: string
  device_id: string
  vehicle_registration: string
  // The EXPECTED precinct — the trip's current phase-ledger stop. Unchanged meaning
  // from before FP-197 Task 3; see expected_trip_stop_id/expected_precinct_name
  // below for the same stop under an unambiguous name.
  precinct_id: string
  precinct_name: string
  latitude: string | null
  longitude: string | null
  has_position: boolean
  // Measured against the EXPECTED precinct above, not the scenario-mode target below.
  distance_metres: number | null
  geofence_radius_metres: number | null
  gps_tolerance_metres: number
  // null (not false) on the no_signal waypoint/scenario — no fix means no verdict was
  // ever computed, which is a different fact from a fix that failed the geofence.
  geofence_confirmed: boolean | null
  in_tolerance_band: boolean
  verdict_reason: string

  // ---- FP-197 Task 3 additions, all nullable: null in legacy waypoint mode, and
  // null for target_* when scenario='no_signal' named no stop. ----

  // The stop scenario mode actually staged the tracker relative to. Distinct from
  // expected_trip_stop_id whenever the operator deliberately targets a stop other
  // than the trip's current one — the whole point of this mode.
  target_trip_stop_id: string | null
  target_precinct_name: string | null
  // The distance scenario mode computed from target_trip_stop_id's own precinct
  // centre — independent of whatever distance_metres above says about the EXPECTED
  // stop. Never render both as "distance from the precinct" — see formatDistance/
  // formatTargetDistance in DevTriggerPanel.tsx.
  target_distance_metres: number | null
  scenario: DevTruckScenario | null

  // The stop precinct_id/precinct_name/distance_metres above actually describe —
  // always populated in both modes.
  expected_trip_stop_id: string | null
  expected_precinct_name: string | null
}

/**
 * The waypoint_id that resets the mock tracker to sit at the precinct. Shared
 * between the panel's per-waypoint buttons and its "Reset to precinct" button
 * so the two never drift onto different literal strings.
 */
export const PRECINCT_WAYPOINT_ID = 'precinct'
