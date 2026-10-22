import { describe, expect, it } from 'vitest'

import { COST_COPY } from './costCopy'

describe('COST_COPY.operating.basis', () => {
  it.each([
    ['week', 'by week departed'],
    ['month', 'by month departed'],
    ['year', 'by year departed'],
  ] as const)('names the View by unit when grouped by %s', (grain, tail) => {
    expect(COST_COPY.operating.basis(3, grain)).toBe(`3 closed trips with a recorded arrival, ${tail}`)
  })

  it('says "trip" for one', () => {
    expect(COST_COPY.operating.basis(1, 'month')).toBe('1 closed trip with a recorded arrival, by month departed')
  })
})
