import { describe, expect, it } from 'vitest'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { SINGLE_LEG_PHASE_PLAN, CROSS_DOCK_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { phaseLocation, stopLabel } from '@/lib/phase'

function distinctStops(plan: readonly PhaseDescriptor[]): number[] {
  return [...new Set(plan.map((p) => p.stop_sequence).filter((s): s is number => s !== null))].sort((a, b) => a - b)
}

describe('stopLabel', () => {
  it('names the first stop Origin and the last Destination on a single-leg plan', () => {
    const [first, last] = [distinctStops(SINGLE_LEG_PHASE_PLAN)[0], distinctStops(SINGLE_LEG_PHASE_PLAN).at(-1)!]

    expect(stopLabel(SINGLE_LEG_PHASE_PLAN, first)).toBe('Origin')
    expect(stopLabel(SINGLE_LEG_PHASE_PLAN, last)).toBe('Destination')
  })

  it('counts intermediate cross-dock stops the way a person does — the origin is stop 1', () => {
    const stops = distinctStops(CROSS_DOCK_PHASE_PLAN)
    expect(stops.length).toBeGreaterThan(2)

    const middle = stopLabel(CROSS_DOCK_PHASE_PLAN, stops[1])

    expect(middle).toBe('Stop 2')
  })

  it('never prints the raw 0-based sequence', () => {
    const labels = distinctStops(CROSS_DOCK_PHASE_PLAN).map((s) => stopLabel(CROSS_DOCK_PHASE_PLAN, s))

    expect(labels).not.toContain('Stop 0')
  })

  it('returns null for trip_creation, which has no stop', () => {
    expect(stopLabel(SINGLE_LEG_PHASE_PLAN, null)).toBeNull()
  })

  it('returns null for a sequence that is not in the plan', () => {
    expect(stopLabel(SINGLE_LEG_PHASE_PLAN, 99)).toBeNull()
  })
})

describe('phaseLocation', () => {
  it('labels an in_transit leg by where it is going, not the stop it departed', () => {
    const leg = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'in_transit')!

    const label = phaseLocation(SINGLE_LEG_PHASE_PLAN, leg)

    expect(label).toBe('To Destination')
  })

  it('points each cross-dock leg at its next stop', () => {
    const legs = CROSS_DOCK_PHASE_PLAN
      .filter((p) => p.phase_type === 'in_transit')
      .sort((a, b) => a.sequence_number - b.sequence_number)

    const labels = legs.map((leg) => phaseLocation(CROSS_DOCK_PHASE_PLAN, leg))

    expect(labels[0]).toBe('To Stop 2')
    expect(labels.at(-1)).toBe('To Destination')
  })

  it('labels every other phase by the stop it happens at', () => {
    const arrival = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'arrival')!

    expect(phaseLocation(SINGLE_LEG_PHASE_PLAN, arrival)).toBe('Destination')
  })
})
