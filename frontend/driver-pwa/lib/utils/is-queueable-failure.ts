// frontend/driver-pwa/lib/utils/is-queueable-failure.ts
//
// Relocated from the old app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx
// (deleted with the fixed-handshake route) so the phase step page — and any future submit
// surface — can share the same enqueue decision instead of re-deriving it inline.
//
// Whether a phase-submission failure is plausibly transient — worth queuing for retry once
// connectivity/the server recovers. A local validation Error thrown by submitPhase BEFORE
// any network call (e.g. "Activation evidence incomplete — GPS is required.") or a terminal
// 4xx can never succeed by simply retrying; queuing those would hand the driver a misleading
// "evidence stored on this device" receipt for evidence that was never actually valid.
import { ApiError } from '@/lib/api/client'

export function isQueueableFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status >= 500
  return err instanceof TypeError
}
