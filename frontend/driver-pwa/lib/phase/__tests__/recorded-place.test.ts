import { describe, it, expect } from 'vitest'
import { recordedPlace } from '../recorded-place'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import type { Trip } from '@shared/lib/types/trip'

const [origin, destination] = mockPrecincts
const trip = {
  phases: SINGLE_LEG_PHASE_PLAN,
  origin_precinct_id: String(origin.id),
  destination_precinct_id: String(destination.id),
} as unknown as Trip
const phase = (type: string) => SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === type)!

describe('recordedPlace', () => {
  it('test_names_the_origin_area_for_a_phase_at_the_origin', () => {
    const expected = origin.name.split(' · ')[1] ?? origin.name

    expect(recordedPlace(trip, phase('departure'))).toBe(expected)
  })

  it('test_names_the_destination_area_for_a_phase_at_the_destination', () => {
    const expected = destination.name.split(' · ')[1] ?? destination.name

    expect(recordedPlace(trip, phase('confirmation'))).toBe(expected)
  })

  it('test_says_nothing_rather_than_guess_an_unknown_precinct', () => {
    const unknown = { ...trip, origin_precinct_id: crypto.randomUUID() } as Trip

    expect(recordedPlace(unknown, phase('departure'))).toBeNull()
  })
})
