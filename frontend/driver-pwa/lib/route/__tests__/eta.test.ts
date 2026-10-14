import { describe, it, expect } from 'vitest'
import {
  estimateArrival,
  legForPhase,
  progressAlongLeg,
  MIN_PACE_SAMPLE_SECONDS,
  PACE_MAX,
  PACE_MIN,
} from '../eta'
import type { TripRoute, TripRouteLeg, RouteCoordinate } from '@/lib/types/route'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// A straight north–south leg along 28°E, -26° to -27° (~111 km), one point per 0.1°.
const LINE: RouteCoordinate[] = Array.from({ length: 11 }, (_, i) => [-26 - i / 10, 28])
const LEG_SECONDS = 6000
const LEG: TripRouteLeg = {
  from_stop_sequence: 1,
  to_stop_sequence: 2,
  distance_metres: 111_000,
  duration_seconds: LEG_SECONDS,
  coordinates: LINE,
}
const SECOND_LEG: TripRouteLeg = { ...LEG, from_stop_sequence: 2, to_stop_sequence: 3 }
const ROUTE: TripRoute = {
  trip_id: 'trip-1',
  provider: 'openrouteservice',
  profile: 'driving-hgv',
  distance_metres: 222_000,
  duration_seconds: 2 * LEG_SECONDS,
  legs: [LEG, SECOND_LEG],
  computed_at: '2026-10-14T08:00:00Z',
}
const NOW = new Date('2026-10-14T12:00:00Z')
const HALFWAY = { lat: -26.5, lng: 28, accuracyM: 10 }

function phase(phaseType: PhaseDescriptor['phase_type'], stopSequence: number | null): PhaseDescriptor {
  return { phase_type: phaseType, stop_sequence: stopSequence } as PhaseDescriptor
}

function secondsBefore(now: Date, seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString()
}

describe('legForPhase', () => {
  it('test_picks_the_leg_leaving_the_in_transit_rows_stop', () => {
    expect(legForPhase(ROUTE, phase('in_transit', 2))).toBe(SECOND_LEG)
  })

  it('test_returns_null_outside_in_transit_or_without_a_route', () => {
    expect(legForPhase(ROUTE, phase('unloading', 2))).toBeNull()
    expect(legForPhase(null, phase('in_transit', 1))).toBeNull()
    expect(legForPhase(ROUTE, null)).toBeNull()
  })

  it('test_returns_null_when_no_leg_leaves_that_stop', () => {
    expect(legForPhase(ROUTE, phase('in_transit', 9))).toBeNull()
  })
})

describe('progressAlongLeg', () => {
  it('test_reads_start_middle_and_end_of_the_line', () => {
    expect(progressAlongLeg(LEG, { lat: -26, lng: 28 })!.fraction).toBeCloseTo(0, 3)
    expect(progressAlongLeg(LEG, HALFWAY)!.fraction).toBeCloseTo(0.5, 3)
    expect(progressAlongLeg(LEG, { lat: -27, lng: 28 })!.fraction).toBeCloseTo(1, 3)
  })

  it('test_measures_distance_off_the_line_in_metres', () => {
    // 0.01° of longitude at -26.5° latitude ≈ 995 m.
    const progress = progressAlongLeg(LEG, { lat: -26.5, lng: 28.01 })!

    expect(progress.offRouteMetres).toBeGreaterThan(980)
    expect(progress.offRouteMetres).toBeLessThan(1010)
    expect(progress.fraction).toBeCloseTo(0.5, 2)
  })

  it('test_returns_null_for_a_leg_with_fewer_than_two_points', () => {
    expect(progressAlongLeg({ ...LEG, coordinates: [[-26, 28]] }, HALFWAY)).toBeNull()
  })
})

describe('estimateArrival', () => {
  it('test_uses_plan_speed_when_departure_is_unknown', () => {
    const estimate = estimateArrival({ leg: LEG, position: HALFWAY, departedAt: null, now: NOW })

    expect(estimate?.kind).toBe('on_route')
    if (estimate?.kind !== 'on_route') return
    expect(estimate.pace).toBe(1)
    expect(estimate.arrivalAt.getTime() - NOW.getTime()).toBeCloseTo((LEG_SECONDS / 2) * 1000, -3)
    expect(estimate.remainingMetres).toBeCloseTo(55_500, -2)
  })

  it('test_stretches_the_remaining_time_by_observed_pace', () => {
    // Plan says halfway takes 3000 s; the truck took 4500 s — 1.5× slower.
    const estimate = estimateArrival({ leg: LEG, position: HALFWAY, departedAt: secondsBefore(NOW, 4500), now: NOW })

    if (estimate?.kind !== 'on_route') throw new Error('expected on_route')
    expect(estimate.pace).toBeCloseTo(1.5, 2)
    expect(estimate.arrivalAt.getTime() - NOW.getTime()).toBeCloseTo(4500 * 1000, -3)
  })

  it('test_clamps_pace_after_a_long_stop', () => {
    const estimate = estimateArrival({ leg: LEG, position: HALFWAY, departedAt: secondsBefore(NOW, 30_000), now: NOW })

    if (estimate?.kind !== 'on_route') throw new Error('expected on_route')
    expect(estimate.pace).toBe(PACE_MAX)
  })

  it('test_clamps_pace_when_ahead_of_plan', () => {
    const estimate = estimateArrival({ leg: LEG, position: HALFWAY, departedAt: secondsBefore(NOW, 1000), now: NOW })

    if (estimate?.kind !== 'on_route') throw new Error('expected on_route')
    expect(estimate.pace).toBe(PACE_MIN)
  })

  it('test_ignores_pace_before_enough_of_the_leg_is_driven', () => {
    // 10% of a 6000 s leg = 600 s planned, under the 15-minute sample floor.
    expect(LEG_SECONDS * 0.1).toBeLessThan(MIN_PACE_SAMPLE_SECONDS)
    const early = { lat: -26.1, lng: 28, accuracyM: 10 }

    const estimate = estimateArrival({ leg: LEG, position: early, departedAt: secondsBefore(NOW, 3000), now: NOW })

    if (estimate?.kind !== 'on_route') throw new Error('expected on_route')
    expect(estimate.pace).toBe(1)
  })

  it('test_reports_off_route_beyond_the_tolerance', () => {
    const estimate = estimateArrival({
      leg: LEG, position: { lat: -26.5, lng: 28.01, accuracyM: 10 }, departedAt: null, now: NOW,
    })

    expect(estimate?.kind).toBe('off_route')
  })

  it('test_widens_the_tolerance_by_the_fix_accuracy', () => {
    // ~995 m off the line, but the fix itself is only good to 600 m.
    const estimate = estimateArrival({
      leg: LEG, position: { lat: -26.5, lng: 28.01, accuracyM: 600 }, departedAt: null, now: NOW,
    })

    expect(estimate?.kind).toBe('on_route')
  })

  it('test_returns_null_for_an_unusable_leg', () => {
    expect(
      estimateArrival({ leg: { ...LEG, coordinates: [] }, position: HALFWAY, departedAt: null, now: NOW }),
    ).toBeNull()
  })
})
