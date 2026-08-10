// Mirror of the backend TripEvent (app/core/realtime.py). The live stream carries only
// these thin notifications — never trip data — so the browser refetches through the
// authorised GET it already trusts.

export type RealtimeKind =
  | 'trip_created'
  | 'phase_completed'
  | 'exception_raised'
  | 'trip_closed'

export interface RealtimeEvent {
  resource: 'trip'
  id: string
  kind: RealtimeKind
  ts: string
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting'
