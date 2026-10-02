import type { Vehicle } from '@shared/lib/types/vehicle'

// South African combination rules: no trailer (a single unit), one trailer of any length,
// or exactly a 6 m + 12 m pair (18 m combined). Anything else is refused before submit.
const SHORT_TRAILER_M = 6
const LONG_TRAILER_M = 12
export const MAX_TRAILERS = 2

export interface TrailerCombo {
  valid: boolean
  message: string
}

export function trailerCombo(selected: readonly Vehicle[]): TrailerCombo {
  if (selected.length === 0) return { valid: true, message: 'Single unit, no trailer' }
  if (selected.length === 1) {
    const only = selected[0]
    const length = only.length_m != null ? `${only.length_m} m` : 'unknown length'
    return { valid: true, message: `${only.registration} · ${length}` }
  }
  if (selected.length === MAX_TRAILERS) {
    const lengths = selected.map(t => t.length_m ?? 0).sort((a, b) => a - b)
    if (lengths[0] === SHORT_TRAILER_M && lengths[1] === LONG_TRAILER_M) {
      return { valid: true, message: '6 m + 12 m combination is valid' }
    }
    return { valid: false, message: `${lengths[0]} m + ${lengths[1]} m exceeds the 18 m limit` }
  }
  return { valid: false, message: 'Maximum 2 trailers allowed' }
}
