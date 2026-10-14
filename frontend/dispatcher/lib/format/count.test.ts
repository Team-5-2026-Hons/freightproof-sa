import { describe, expect, it } from 'vitest'
import { countLabel } from './count'

describe('countLabel', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'parcel')).toBe('1 parcel')
  })

  it('pluralises zero and many', () => {
    expect(countLabel(0, 'parcel')).toBe('0 parcels')
    expect(countLabel(2, 'parcel')).toBe('2 parcels')
  })

  it('takes an explicit plural for irregular nouns', () => {
    expect(countLabel(1, 'person', 'people')).toBe('1 person')
    expect(countLabel(3, 'person', 'people')).toBe('3 people')
  })
})
