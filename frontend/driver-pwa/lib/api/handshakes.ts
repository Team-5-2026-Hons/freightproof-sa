// frontend/driver-pwa/lib/api/handshakes.ts
import type { HandshakeType } from '@shared/lib/types/handshake'
import type { HandshakeEvidence } from '@/lib/types/evidence-draft'
import { IS_DEMO_MODE } from '@/lib/constants/env'

export interface SubmitHandshakeResult {
  ok: boolean
  eventHash: string
}

// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock success immediately.
// Production: POSTs to the backend handshake endpoint (to be implemented in a separate plan).
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function submitHandshake(
  tripId: string,
  handshakeType: HandshakeType,
  evidence: HandshakeEvidence,
): Promise<SubmitHandshakeResult> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, eventHash: crypto.randomUUID() }
  }

  const resp = await fetch(`${BACKEND_URL}/api/v1/trips/${tripId}/handshakes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handshake_type: handshakeType, evidence }),
  })

  if (!resp.ok) {
    // TODO(backend-integration): include response body in this error once the real endpoint exists
    throw new Error(`submitHandshake failed: HTTP ${resp.status}`)
  }

  const result = (await resp.json()) as SubmitHandshakeResult

  // A 200 response with ok: false (partial success, pending validation, etc.) is still
  // a failure — throw so the existing "resolves = success, throws = failure" contract
  // callers rely on (e.g. useOfflineQueue.flush) actually holds.
  if (!result.ok) {
    throw new Error('submitHandshake failed: backend returned ok: false')
  }

  return result
}
