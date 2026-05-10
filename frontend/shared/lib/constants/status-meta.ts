import type { TripStatus } from '@shared/lib/types/trip'
import type { HandshakeStatus } from '@shared/lib/types/handshake'
import type { ExceptionType, ExceptionSeverity, ExceptionSource } from '@shared/lib/types/exception'

// ChipKind matches the Chip component's kind prop — see components/ui/Chip.tsx.
export type ChipKind = 'success' | 'warning' | 'error' | 'pending' | 'overridden' | 'info'

export interface StatusMeta {
  label: string
  chipKind: ChipKind
  iconName: string  // Lucide icon name — import { IconName } from 'lucide-react'
}

// ─── Trip status ───────────────────────────────────────────────────────────────

export const TRIP_STATUS_META: Record<TripStatus, StatusMeta> = {
  created:         { label: 'Trip Created',        chipKind: 'info',       iconName: 'Clock' },
  origin_gate_in:  { label: 'At Origin Gate',      chipKind: 'pending',    iconName: 'MapPin' },
  loading:         { label: 'Loading',             chipKind: 'pending',    iconName: 'Package' },
  origin_gate_out: { label: 'Departed Origin',     chipKind: 'pending',    iconName: 'Truck' },
  in_transit:      { label: 'In Transit',          chipKind: 'info',       iconName: 'Navigation' },
  dest_gate_in:    { label: 'At Destination Gate', chipKind: 'pending',    iconName: 'MapPin' },
  unloading:       { label: 'Unloading',           chipKind: 'pending',    iconName: 'PackageOpen' },
  closed:          { label: 'Closed',              chipKind: 'success',    iconName: 'CheckCircle2' },
  cancelled:       { label: 'Cancelled',           chipKind: 'error',      iconName: 'XCircle' },
  exception_hold:  { label: 'On Hold',             chipKind: 'warning',    iconName: 'AlertTriangle' },
}

// ─── Handshake status ─────────────────────────────────────────────────────────

export const HANDSHAKE_STATUS_META: Record<HandshakeStatus, StatusMeta> = {
  pending:     { label: 'Pending',     chipKind: 'info',       iconName: 'Circle' },
  in_progress: { label: 'In Progress', chipKind: 'pending',    iconName: 'Loader' },
  completed:   { label: 'Completed',   chipKind: 'success',    iconName: 'CheckCircle2' },
  exception:   { label: 'Exception',   chipKind: 'error',      iconName: 'AlertTriangle' },
  overridden:  { label: 'Overridden',  chipKind: 'overridden', iconName: 'ShieldAlert' },
}

// ─── Exception severity ───────────────────────────────────────────────────────

export const EXCEPTION_SEVERITY_META: Record<ExceptionSeverity, StatusMeta> = {
  info:     { label: 'Info',     chipKind: 'info',    iconName: 'Info' },
  warning:  { label: 'Warning',  chipKind: 'warning', iconName: 'AlertTriangle' },
  critical: { label: 'Critical', chipKind: 'error',   iconName: 'AlertOctagon' },
}

// ─── Exception source ─────────────────────────────────────────────────────────

export const EXCEPTION_SOURCE_META: Record<ExceptionSource, { label: string; iconName: string }> = {
  system:     { label: 'System',     iconName: 'Bot' },
  driver:     { label: 'Driver',     iconName: 'User' },
  dispatcher: { label: 'Dispatcher', iconName: 'Headphones' },
}

// ─── Exception type groupings ─────────────────────────────────────────────────
// Used by the driver exception picker and dispatcher exception feed filters.

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
