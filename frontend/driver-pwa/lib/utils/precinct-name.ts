import { mockPrecincts } from '@shared/lib/mocks/precincts'

// Number of leading id characters shown when a precinct can't be resolved to a
// name — enough to stay visibly unique without dumping a full UUID on the card.
const FALLBACK_ID_CHARS = 8

// Resolve a precinct id to its short display name for trip cards.
// Fallback for demo rows and unresolved precincts: the raw id's first 8 chars, so an
// unknown id is still visibly unique.
export function precinctName(precinctId: string): string {
  const precinct = mockPrecincts.find((p) => String(p.id) === precinctId)
  return precinct?.name ?? precinctId.slice(0, FALLBACK_ID_CHARS)
}

/**
 * The precinct's name only when it is actually known, else null — for screens that have
 * a better fallback than an id fragment (the trip page labels stops by position instead).
 */
export function knownPrecinctName(precinctId: string): string | null {
  return mockPrecincts.find((p) => String(p.id) === precinctId)?.name ?? null
}
