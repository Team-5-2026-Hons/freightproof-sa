// Mirror of the backend TripEvent (app/core/realtime.py). The live stream carries only
// these thin notifications — never trip data — so the browser refetches through the
// authorised GET it already trusts.

// What changed. Says nothing about how loudly to react — that's `severity` below.
export type RealtimeKind =
  | 'trip_created'
  | 'phase_completed'
  | 'exception_raised'
  | 'exception_reviewed'
  | 'exception_claimed'
  | 'trip_closed'
  | 'evidence_uploaded'
  | 'driver_substitution_changed'
  | 'late_driver_evidence_changed'
  | 'incident_changed'

export const KIND_CHANGES_TRIP_RECORD: Record<RealtimeKind, boolean> = {
  trip_created: true,
  phase_completed: true,
  exception_raised: true,
  exception_reviewed: true,
  exception_claimed: true,
  trip_closed: true,
  evidence_uploaded: false,
  driver_substitution_changed: true,
  late_driver_evidence_changed: false,
  incident_changed: false,
}

export const TRIP_RECORD_KINDS: readonly RealtimeKind[] = (
  Object.keys(KIND_CHANGES_TRIP_RECORD) as RealtimeKind[]
).filter(kind => KIND_CHANGES_TRIP_RECORD[kind])

export type EventSeverity = 'info' | 'warning' | 'critical'

export interface RealtimeEvent {
  resource: 'trip'
  id: string
  kind: RealtimeKind
  severity: EventSeverity
  ts: string
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting'
