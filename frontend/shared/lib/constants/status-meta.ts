import type { TripStatus } from '@shared/lib/types/trip'
import type { HandshakeStatus } from '@shared/lib/types/handshake'
import type { ExceptionType, ExceptionSeverity, ExceptionSource } from '@shared/lib/types/exception'

/** Six domain chip types — matches Chip component and DESIGN_SYSTEM.md §7.2. */
export type ChipType = 'transit' | 'loading' | 'complete' | 'exception' | 'critical' | 'pending'

export interface StatusMeta {
  label: string
  chipType: ChipType
  iconName: string  // Lucide icon name
}

// ─── Trip status ───────────────────────────────────────────────────────────────

export const TRIP_STATUS_META: Record<TripStatus, StatusMeta> = {
  created:         { label: 'Created',          chipType: 'pending',   iconName: 'Clock' },
  origin_gate_in:  { label: 'At Origin Gate',   chipType: 'transit',   iconName: 'MapPin' },
  loading:         { label: 'Loading',          chipType: 'loading',   iconName: 'Package' },
  origin_gate_out: { label: 'Gate Out',         chipType: 'transit',   iconName: 'Truck' },
  in_transit:      { label: 'In Transit',       chipType: 'transit',   iconName: 'Navigation' },
  dest_gate_in:    { label: 'At Dest. Gate',    chipType: 'transit',   iconName: 'MapPin' },
  unloading:       { label: 'Unloading',        chipType: 'loading',   iconName: 'PackageOpen' },
  closed:          { label: 'Complete',         chipType: 'complete',  iconName: 'CheckCircle2' },
  cancelled:       { label: 'Cancelled',        chipType: 'critical',  iconName: 'XCircle' },
  exception_hold:  { label: 'Exception',        chipType: 'exception', iconName: 'AlertTriangle' },
}

// ─── Handshake status ─────────────────────────────────────────────────────────

export const HANDSHAKE_STATUS_META: Record<HandshakeStatus, StatusMeta> = {
  pending:     { label: 'Pending',     chipType: 'pending',   iconName: 'Circle' },
  in_progress: { label: 'In Progress', chipType: 'transit',   iconName: 'Loader' },
  completed:   { label: 'Completed',   chipType: 'complete',  iconName: 'CheckCircle2' },
  exception:   { label: 'Exception',   chipType: 'exception', iconName: 'AlertTriangle' },
  overridden:  { label: 'Overridden',  chipType: 'exception', iconName: 'ShieldAlert' },
}

// ─── Exception severity ───────────────────────────────────────────────────────

export const EXCEPTION_SEVERITY_META: Record<ExceptionSeverity, StatusMeta> = {
  info:     { label: 'Info',     chipType: 'pending',   iconName: 'Info' },
  warning:  { label: 'Warning',  chipType: 'exception', iconName: 'AlertTriangle' },
  critical: { label: 'Critical', chipType: 'critical',  iconName: 'AlertOctagon' },
}

// ─── Exception source ─────────────────────────────────────────────────────────

export const EXCEPTION_SOURCE_META: Record<ExceptionSource, { label: string; iconName: string }> = {
  system:     { label: 'System',     iconName: 'Bot' },
  driver:     { label: 'Driver',     iconName: 'User' },
  dispatcher: { label: 'Dispatcher', iconName: 'Headphones' },
}

// ─── Exception type groupings ─────────────────────────────────────────────────

export const DRIVER_EXCEPTION_TYPES: ExceptionType[] = [
  'delivery_refused',
  'cargo_damage',
  'seal_broken_in_transit',
  'mechanical',
  'document_review',
  'panic_button',
]

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

export const DISPATCHER_EXCEPTION_TYPES: ExceptionType[] = [
  'dispatcher_note',
  'escalation',
  'trip_hold',
]
