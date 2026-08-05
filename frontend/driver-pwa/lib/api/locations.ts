// frontend/driver-pwa/lib/api/locations.ts
//
// The driver's per-trip location trail. Replaces the three manual "Capture GPS Location"
// steps: instead of the driver tapping a button at three points in the journey, the app
// records where they were every time they act on an open trip.
//
// POPIA: personal location data. It goes to FreightProof's own API and nowhere else —
// never to Hedera, never to a third party.
import { api } from './client'

/** One position fix, in the shape the backend's LocationPingCreate expects. */
export interface LocationPingBody {
  lat: number
  lng: number
  // Metres of horizontal uncertainty, when the platform reports one. Omitted rather
  // than zeroed when it doesn't — 0 would claim a perfect fix.
  accuracy_m?: number
  // What the driver was doing: a route path, or an action name like 'phase-submit'.
  context: string
  // When the DEVICE took the fix (ISO-8601). Not the send time — a replayed offline
  // ping is hours older than its request, and the trail is ordered by this.
  recorded_at: string
}

export interface LocationBatchResult {
  recorded: number
}

/** Append fixes to one trip's trail. Batched so an offline backlog flushes in one call. */
export const recordLocations = (
  tripId: string,
  pings: LocationPingBody[],
): Promise<LocationBatchResult> =>
  api.post<LocationBatchResult>(`/api/v1/trips/${tripId}/locations`, { pings })
