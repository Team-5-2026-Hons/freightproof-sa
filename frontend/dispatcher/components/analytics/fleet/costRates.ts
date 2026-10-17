// The admin's editable cost rates (FP-294, Stage 5): which fields, their limits, and how a
// typed value becomes a number. The limits mirror the backend's (app/core/constants.py and
// app/schemas/cost_analytics.py), so the form rejects exactly what the server would; the
// server still checks, and its message is shown if it ever disagrees.

import type { CostProfile, CostProfileUpdate } from '@shared/lib/types/cost-analytics'

export type EditableRate = keyof Required<CostProfileUpdate>

interface RateLimits {
  min: number
  /** true: the value must be above min, not equal to it. */
  minExclusive: boolean
  max: number
  decimals: number
}

// No real rand rate comes near R1,000,000; the cap catches a typo (an extra few zeros).
const MAX_RAND = 1_000_000
const RAND: RateLimits = { min: 0, minExclusive: false, max: MAX_RAND, decimals: 2 }

export const RATE_LIMITS: Record<EditableRate, RateLimits> = {
  diesel_price_per_litre: RAND,
  // A loaded heavy truck burns roughly 30-60 L/100 km; above 200 is a typo, not a truck.
  litres_per_100km: { min: 0, minExclusive: true, max: 200, decimals: 1 },
  running_cost_per_km: RAND,
  driver_cost_per_hour: RAND,
  delay_cost_per_hour: RAND,
  fixed_cost_per_trip: RAND,
  // Road distance is never shorter than the straight line, and never more than twice it.
  road_factor: { min: 1, minExclusive: false, max: 2, decimals: 2 },
}

export const EDITABLE_RATES = Object.keys(RATE_LIMITS) as EditableRate[]

export type RateDraft = Record<EditableRate, string>

/** The form's starting text: the current rates. */
export function draftFrom(rates: CostProfile): RateDraft {
  return Object.fromEntries(EDITABLE_RATES.map((key) => [key, String(rates[key])])) as RateDraft
}

/** A typed value as a number, or null when it isn't one. A decimal comma ("33,29") is
 *  accepted, since that is how South African prices are written. */
export function parseRate(text: string): number | null {
  const normalised = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null
  return Number(normalised)
}

/** Why a typed value is refused, or null when it is fine. */
export function rateProblem(key: EditableRate, text: string): string | null {
  const limits = RATE_LIMITS[key]
  const value = parseRate(text)
  if (value === null) return 'Enter a number.'
  const decimals = text.trim().replace(',', '.').split('.')[1]?.length ?? 0
  if (decimals > limits.decimals) {
    return limits.decimals === 1 ? 'Use at most 1 decimal place.' : `Use at most ${limits.decimals} decimal places.`
  }
  if (limits.minExclusive ? value <= limits.min : value < limits.min) {
    return limits.minExclusive ? `Must be more than ${limits.min}.` : `Must be at least ${limits.min}.`
  }
  if (value > limits.max) return `Must be at most ${limits.max.toLocaleString('en-ZA')}.`
  return null
}

/** Every field's problem, keyed by field; empty when the whole form is fine. */
export function draftProblems(draft: RateDraft): Partial<Record<EditableRate, string>> {
  const problems: Partial<Record<EditableRate, string>> = {}
  for (const key of EDITABLE_RATES) {
    const problem = rateProblem(key, draft[key])
    if (problem !== null) problems[key] = problem
  }
  return problems
}

/** Only the rates the admin actually changed, so a save never rewrites the others. */
export function changedRates(draft: RateDraft, rates: CostProfile): CostProfileUpdate {
  const update: CostProfileUpdate = {}
  for (const key of EDITABLE_RATES) {
    const value = parseRate(draft[key])
    if (value !== null && value !== rates[key]) update[key] = value
  }
  return update
}
