// frontend/driver-pwa/lib/api/handover.ts
//
// The driver's half of the receiver handover (FP-155). Two calls, both authenticated as
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
  /**
   * The full URL encoded into the QR, composed server-side — never built here.
   *
   * Null when `receiver_opened` is true: the receiver already has a live code open, and
   * issuing another would retire the one in their hand. Not an error state.
   */
  scan_url: string | null
  expires_at: string
  /** Server-owned cadence, so an installed APK follows a change without a rebuild. */
  rotate_after_seconds: number
  /** True once the receiver's browser has loaded the link. Stops the rotation. */
  receiver_opened: boolean
}

export interface HandoverStatusResponse {
  confirmed: boolean
  confirmed_at: string | null
  /** Scan landed, swipe not done yet. Display only — tells the driver it is working. */
  receiver_opened: boolean
  /**
   * The artifact the receiver's browser produced, which the driver then submits as
   * ConfirmationCompleteRequest.pod_signature_artifact_id. Null until they confirm — the
   * step must not let the driver past while it is null, or the phase 422s.
   */
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
): Promise<HandoverTokenResponse> {
  const query = force ? '?force=true' : ''
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
