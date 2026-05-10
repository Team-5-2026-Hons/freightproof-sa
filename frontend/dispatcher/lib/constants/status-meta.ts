import type { ExceptionType } from '@shared/lib/types/exception'

// Driver raises these from the /in-transit/exception picker screen.
// System-detected types are never shown as driver options.
export const DRIVER_EXCEPTION_TYPES: ExceptionType[] = [
  'delivery_refused',
  'cargo_damage',
  'seal_broken_in_transit',
  'mechanical',
  'document_review',
  'panic_button',
]

// Raised automatically by backend validation — never offered as driver selections.
export const SYSTEM_EXCEPTION_TYPES: ExceptionType[] = [
  'seal_mismatch',
  'parcel_count_mismatch',
  'gps_mismatch',
  'route_deviation',
  'vehicle_substitution',
  'driver_substitution',
  'checkpoint_timeout',
  'waybill_count_mismatch',
  'sequence_violation',
]

// Raised from the dispatcher dashboard only.
export const DISPATCHER_EXCEPTION_TYPES: ExceptionType[] = [
  'dispatcher_note',
  'escalation',
  'trip_hold',
]
