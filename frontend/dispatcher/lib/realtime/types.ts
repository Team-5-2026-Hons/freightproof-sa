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
  // FP-83: a driver handover was arranged, cancelled, replaced or completed.
  | 'driver_substitution_changed'

// Whether an event can change the trip record, its manifest or the live trip list. A
// Record, not a list, so adding a kind to RealtimeKind fails to compile until someone
// decides which resources it refreshes. An evidence upload only adds an artifact row; the
// trip, manifest and list rows are unchanged by it.
export const KIND_CHANGES_TRIP_RECORD: Record<RealtimeKind, boolean> = {
  trip_created: true,
  phase_completed: true,
  exception_raised: true,
  exception_reviewed: true,
  exception_claimed: true,
  trip_closed: true,
  evidence_uploaded: false,
  // The trip's current driver, pending arrangement and custody chain live on the trip record.
  driver_substitution_changed: true,
}

// Derived from the map above so the subscription filter cannot drift from the decision.
export const TRIP_RECORD_KINDS: readonly RealtimeKind[] = (
  Object.keys(KIND_CHANGES_TRIP_RECORD) as RealtimeKind[]
).filter(kind => KIND_CHANGES_TRIP_RECORD[kind])

// How much it matters, read off the same value the backend writes onto TripException
// (core/realtime.py event_severity).
export type EventSeverity = 'info' | 'warning' | 'critical'

export interface RealtimeEvent {
  resource: 'trip'
  id: string
  kind: RealtimeKind
  severity: EventSeverity
  ts: string
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting'
