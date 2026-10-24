import { describe, expect, it } from 'vitest'

import type { CostProfile } from '@shared/lib/types/cost-analytics'
import { changedRates, draftFrom, draftProblems, parseRate, rateProblem } from './costRates'

const RATES: CostProfile = {
  diesel_price_per_litre: 33.29, litres_per_100km: 53, fuel_per_km: 17.6437, running_cost_per_km: 15.1,
  driver_cost_per_hour: 155, delay_cost_per_hour: 1100, fixed_cost_per_trip: 0, road_factor: 1.15,
  is_default: true, updated_at: null, updated_by_name: null,
}

describe('parseRate', () => {
  it.each([['33.29', 33.29], ['33,29', 33.29], [' 155 ', 155], ['0', 0]])('reads %s as %s', (text, value) => {
    expect(parseRate(text)).toBe(value)
  })

  it.each(['', 'abc', '-1', '1.2.3', '1e5'])('refuses %s', (text) => {
    expect(parseRate(text)).toBeNull()
  })
})

describe('rateProblem', () => {
  it('matches the backend bounds at their edges', () => {
    expect(rateProblem('road_factor', '1')).toBeNull()
    expect(rateProblem('road_factor', '2')).toBeNull()
    expect(rateProblem('road_factor', '2.01')).toBe('Must be at most 2.')
    expect(rateProblem('litres_per_100km', '200')).toBeNull()
    expect(rateProblem('litres_per_100km', '200.1')).toBe('Must be at most 200.')
    expect(rateProblem('litres_per_100km', '0')).toBe('Must be more than 0.')
    expect(rateProblem('fixed_cost_per_trip', '0')).toBeNull()
    // The thousands separator is whatever space Intl uses for en-ZA on this machine.
    expect(rateProblem('driver_cost_per_hour', '1000001')).toMatch(/^Must be at most 1\s000\s000\.$/)
  })

  it('limits decimals to how the value is stored', () => {
    expect(rateProblem('litres_per_100km', '53.25')).toBe('Use at most 1 decimal place.')
    expect(rateProblem('diesel_price_per_litre', '33.299')).toBe('Use at most 2 decimal places.')
  })
})

describe('draft helpers', () => {
  it('starts from the current rates with no problems', () => {
    expect(draftProblems(draftFrom(RATES))).toEqual({})
  })

  it('sends only the rates that changed', () => {
    const draft = { ...draftFrom(RATES), delay_cost_per_hour: '900', road_factor: '1.15' }

    expect(changedRates(draft, RATES)).toEqual({ delay_cost_per_hour: 900 })
  })
})
