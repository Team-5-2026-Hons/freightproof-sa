// The driver's half of the receiver handover. Two calls, both authenticated as
// the driver: mint the next QR in the rotating series, and ask whether the receiver has
// confirmed yet.
//
// Neither call is queued offline, and that is deliberate rather than an omission. A
// capability token is only useful while a receiver is standing in front of the driver
// with a phone, and a token minted from a queue that drained twenty minutes later is a
// grant nobody asked for. Offline, the step says so and the driver waits for signal —
// see components/phase/steps/confirmation/ReceiverHandover.tsx.

import { api } from '@/lib/api/client'

export interface HandoverTokenResponse {
  scan_url: string | null
  expires_at: string
  rotate_after_seconds: number
  receiver_opened: boolean
}

export interface HandoverStatusResponse {
  confirmed: boolean
  confirmed_at: string | null
  receiver_opened: boolean
  signature_artifact_id: string | null
}

/**
 * Mint the next code in the series.
 *
 * `force` is the driver's "show a new code" escape hatch. It exists for one case: the
 * receiver opened the link and then lost the browser session holding their binding
 * cookie, so they can neither confirm nor be issued a fresh code until the grant
 * expires. Forcing retires the stranded token and starts the series again.
 */
export function issueHandoverToken(
  tripId: string,
  phaseEventId: string,
  force = false,
  custodySequence: number | null = null,
): Promise<HandoverTokenResponse> {
  const params = new URLSearchParams()
  if (force) params.set('force', 'true')
  if (custodySequence !== null) params.set('custody_sequence', String(custodySequence))
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return api.post<HandoverTokenResponse>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/handover/tokens${query}`,
  )
}

export function fetchHandoverStatus(
  tripId: string,
  phaseEventId: string,
): Promise<HandoverStatusResponse> {
  return api.get<HandoverStatusResponse>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/handover`,
  )
}
