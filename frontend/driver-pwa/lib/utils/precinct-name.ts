import { mockPrecincts } from '@shared/lib/mocks/precincts'

// Number of leading id characters shown when a precinct can't be resolved to a
// name — enough to stay visibly unique without dumping a full UUID on the card.
const FALLBACK_ID_CHARS = 8

// Resolve a precinct id to its short display name for trip cards.
// Mock-backed until GET /driver/trips nests precinct names (backend Iter 2);
// falls back to the raw id's first 8 chars so an unknown id is still visibly unique.
export function precinctName(precinctId: string): string {
  const precinct = mockPrecincts.find((p) => String(p.id) === precinctId)
  return precinct?.name ?? precinctId.slice(0, FALLBACK_ID_CHARS)
}
