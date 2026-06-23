import type { HandshakeEvent } from '@shared/lib/types/handshake'

export type HandshakeStageState = 'completed' | 'current' | 'exception' | 'upcoming'

const STAGE_NUMBERS = [1, 2, 3, 4, 5] as const

// Derived from trip.handshakes (authoritative per-handshake status), not trip.status —
// trip.status alone can't distinguish "in transit between H3 and H4" from "no handshake
// started yet", but the handshake records always carry the real per-stage status.
export function handshakeProgress(
  handshakes: HandshakeEvent[],
): Record<1 | 2 | 3 | 4 | 5, HandshakeStageState> {
  const result = {} as Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>

  for (const n of STAGE_NUMBERS) {
    const event = handshakes.find((h) => h.sequence_number === n)
    if (!event || event.status === 'pending') {
      result[n] = 'upcoming'
    } else if (event.status === 'in_progress') {
      result[n] = 'current'
    } else if (event.status === 'exception') {
      result[n] = 'exception'
    } else {
      // 'completed' or 'overridden'
      result[n] = 'completed'
    }
  }

  return result
}
