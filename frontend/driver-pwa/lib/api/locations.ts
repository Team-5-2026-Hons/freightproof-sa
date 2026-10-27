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
  accuracy_m?: number
  context: string
  recorded_at: string
}

export interface LocationBatchResult {
  recorded: number
}

/**
 * Append fixes to one trip's trail. Batched so an offline backlog flushes in one call.
 * `custodySequence` is the period the fixes were TAKEN in; a queued batch carries its
 * own, so it never adopts whatever period is current when signal returns.
 */
export const recordLocations = (
  tripId: string,
  pings: LocationPingBody[],
  custodySequence: number | null = null,
): Promise<LocationBatchResult> =>
  api.post<LocationBatchResult>(`/api/v1/trips/${tripId}/locations`, {
    pings,
    ...(custodySequence !== null ? { custody_sequence: custodySequence } : {}),
  })
