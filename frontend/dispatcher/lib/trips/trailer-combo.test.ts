import { describe, expect, it } from 'vitest'
import { mockTrailers } from '@shared/lib/mocks/vehicles'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { trailerCombo } from './trailer-combo'

function trailer(registration: string, length_m: number | null): Vehicle {
  return { ...mockTrailers[0], id: registration as Vehicle['id'], registration, length_m }
}

describe('trailerCombo', () => {
  it('allows a single unit and any one trailer', () => {
    expect(trailerCombo([]).valid).toBe(true)
    expect(trailerCombo([trailer('T-9', 9)])).toEqual({ valid: true, message: 'T-9 · 9 m' })
    expect(trailerCombo([trailer('T-X', null)]).message).toBe('T-X · unknown length')
  })

  it('allows two trailers only as 6 m + 12 m, in either order', () => {
    expect(trailerCombo([trailer('T-12', 12), trailer('T-6', 6)]).valid).toBe(true)
    expect(trailerCombo([trailer('T-12', 12), trailer('T-12b', 12)])).toEqual({
      valid: false, message: '12 m + 12 m exceeds the 18 m limit',
    })
  })

  it('refuses a third trailer', () => {
    expect(trailerCombo([trailer('A', 6), trailer('B', 12), trailer('C', 6)])).toEqual({
      valid: false, message: 'Maximum 2 trailers allowed',
    })
  })
})
