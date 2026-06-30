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

// Which single handshake the driver should currently act on — the first stage (in
// H1-H5 order) that isn't 'completed' yet. That's the in-progress one if there is
// one, otherwise the next not-yet-started one, otherwise (if an earlier stage is in
// 'exception') the exception stage itself, since 'exception' isn't 'completed'
// either. Returns null once every stage is completed (trip closed) — nothing left
// to show.
export function currentHandshakeNumber(
  progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>,
): 1 | 2 | 3 | 4 | 5 | null {
  return STAGE_NUMBERS.find((n) => progress[n] !== 'completed') ?? null
}
