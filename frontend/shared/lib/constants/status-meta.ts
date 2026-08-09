import type { CoarseTripStatus, PhaseStatus } from '@shared/lib/types/phase'
import type { ExceptionType, ExceptionSeverity, ExceptionSource } from '@shared/lib/types/exception'

/** Six domain chip types — matches Chip component and DESIGN_SYSTEM.md §7.2. */
export type ChipType = 'transit' | 'loading' | 'complete' | 'exception' | 'critical' | 'pending'

export interface StatusMeta {
  label: string
  chipType: ChipType
  iconName: string  // Lucide icon name
}

// ─── Trip status ───────────────────────────────────────────────────────────────

// Coarse since Stage 2 — five values, not ten. `active` covers everything between
// creation and closure; WHERE in the plan a trip is comes from the ledger, never
// from here.
export const TRIP_STATUS_META: Record<CoarseTripStatus, StatusMeta> = {
  created:         { label: 'Created',   chipType: 'pending',   iconName: 'Clock' },
  active:          { label: 'Active',    chipType: 'transit',   iconName: 'Truck' },
  closed:          { label: 'Complete',  chipType: 'complete',  iconName: 'CheckCircle2' },
  cancelled:       { label: 'Cancelled', chipType: 'critical',  iconName: 'XCircle' },
  exception_hold:  { label: 'Exception', chipType: 'exception', iconName: 'AlertTriangle' },
}

// ─── Phase status ─────────────────────────────────────────────────────────────

export const PHASE_STATUS_META: Record<PhaseStatus, StatusMeta> = {
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
