/**
 * Types for the dev trigger panel. Mirrors backend/app/schemas/dev.py.
 *
 * Dispatcher-local rather than in @shared: the driver surface never sees
 * parcel-grain scan data, so this contract has exactly one consumer.
 */

export type ScanDirection = 'out' | 'in'

export interface DevTripStop {
  trip_stop_id: string
  sequence: number
  precinct_name: string
  pickup_consignment_references: string[]
  delivery_consignment_references: string[]
}

export interface DevTripSummary {
  trip_id: string
  trip_reference: string
  status: string
  current_phase: string | null
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
}

export interface ScanTriggerResponse {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  consignments: ConsignmentScanResult[]
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
