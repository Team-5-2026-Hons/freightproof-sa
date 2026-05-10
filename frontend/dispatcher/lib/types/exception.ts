// Exception: a recorded deviation from the expected trip workflow. Can be raised
// by the driver, detected automatically by the system, or noted by a dispatcher.
// Corresponds to backend ExceptionType/ExceptionSource/ExceptionSeverity enums.

export type ExceptionId = string & { readonly __brand: 'ExceptionId' }

// All 18 backend ExceptionType values — see DRIVER_EXCEPTION_TYPES and
// SYSTEM_EXCEPTION_TYPES in lib/constants/status-meta.ts for the UI split.
export type ExceptionType =
  // System-detected (raised automatically by backend validation logic)
  | 'seal_mismatch'
  | 'parcel_count_mismatch'
  | 'gps_mismatch'
  | 'route_deviation'
  | 'vehicle_substitution'
  | 'driver_substitution'
  | 'checkpoint_timeout'
  | 'waybill_count_mismatch'
  | 'sequence_violation'
  // Driver-selectable (driver raises these from the exception picker screen)
  | 'panic_button'
  | 'delivery_refused'
  | 'cargo_damage'
  | 'seal_broken_in_transit'
  | 'mechanical'
  | 'document_review'
  // Dispatcher-created (raised from the dispatcher dashboard)
  | 'dispatcher_note'
  | 'escalation'
  | 'trip_hold'

export type ExceptionSource = 'system' | 'driver' | 'dispatcher'

export type ExceptionSeverity = 'info' | 'warning' | 'critical'

export interface Exception {
  id: ExceptionId
  type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  description: string
  createdAt: string
  resolvedAt: string | null
}
