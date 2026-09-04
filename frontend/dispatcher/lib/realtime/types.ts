// Mirror of the backend TripEvent (app/core/realtime.py). The live stream carries only
// these thin notifications — never trip data — so the browser refetches through the
// authorised GET it already trusts.

// What changed. Deliberately says nothing about how loudly to react — that is
// `severity` below, and keeping the two apart is what lets the ledger add kinds
// without each needing a loud and a quiet variant.
export type RealtimeKind =
  | 'trip_created'
  | 'phase_completed'
  | 'exception_raised'
  | 'trip_closed'

// How much it matters. The backend reads this off the same value it writes onto the
// TripException row (core/realtime.py event_severity), so a driver's panic button and
// a system-detected seal mismatch rank together on what they are, not on which code
// path happened to publish them.
export type EventSeverity = 'info' | 'warning' | 'critical'

export interface RealtimeEvent {
  resource: 'trip'
  id: string
  kind: RealtimeKind
  severity: EventSeverity
  ts: string
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting'
