import { mockPrecincts } from '@shared/lib/mocks/precincts'

const FALLBACK_ID_CHARS = 8

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
