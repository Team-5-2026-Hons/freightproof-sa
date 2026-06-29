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

// Which handshake numbers the driver should be able to see/act on right now — H1 only
// until H1 starts, then H1-H2 once H1 starts, etc. The next not-yet-started handshake is
// always shown alongside everything already underway/done, so the driver always has a
// button to tap; anything further out stays hidden since it isn't reachable yet.
export function visibleHandshakeNumbers(
  progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>,
): (1 | 2 | 3 | 4 | 5)[] {
  const startedCount = STAGE_NUMBERS.filter((n) => progress[n] !== 'upcoming').length
  const reachable = startedCount + 1
  return STAGE_NUMBERS.filter((n) => n <= reachable)
}
