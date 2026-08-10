import { describe, it, expect } from 'vitest'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctName } from '../precinct-name'

describe('precinctName', () => {
  it('resolves a known precinct id to its display name', () => {
    const known = mockPrecincts[0]

    expect(precinctName(String(known.id))).toBe(known.name)
  })

  it('falls back to the first 8 chars of an unknown id', () => {
    const unknownId = 'ffffffff-0000-0000-0000-000000000000'

    expect(precinctName(unknownId)).toBe('ffffffff')
  })
})
