// Mirror of the backend TripEvent (app/core/realtime.py). The live stream carries only
// these thin notifications — never trip data — so the browser refetches through the
// authorised GET it already trusts.

// What changed. Says nothing about how loudly to react — that's `severity` below.
export type RealtimeKind =
  | 'trip_created'
  | 'phase_completed'
  | 'exception_raised'
  | 'exception_reviewed'
  | 'trip_closed'

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
