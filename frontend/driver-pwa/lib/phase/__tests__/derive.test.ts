import { describe, expect, it } from 'vitest'
import {
  CROSS_DOCK_PHASE_PLAN,
  makePhasePlan,
  SINGLE_LEG_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { STEP_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isAnchored, planProgress, stepsFor } from '../derive'

// Marks every phase up to and including `through` (by sequence_number) as completed.
// Local to the test file on purpose — the module under test must not gain a helper
// that only tests use (mirrors the equivalent helper in dispatcher/lib/phase/derive.test.ts).
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

describe('currentPhase', () => {
  it('is the sequence-0 row on a fully-pending single-leg plan', () => {
    const current = currentPhase(SINGLE_LEG_PHASE_PLAN)

    expect(current?.sequence_number).toBe(0)
  })

  it('returns row N+1 on the 11-row cross-dock plan with the first N resolved', () => {
    // Resolves sequence 0..8 (9 rows) — past what a plan hardcoded to a 7-row bound
    // could even index into, so this specifically catches a single-leg-shaped assumption.
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 8)
    const current = currentPhase(plan)

    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(11)
    expect(current?.sequence_number).toBe(9)
    expect(current?.phase_type).toBe('unloading')
  })

  it('returns the THIRD unloading, not the first, when the first two are resolved', () => {
    // A synthetic 4-stop plan where every stop after the first drops off cargo, so
    // `unloading` occurs three times. This is the cross-dock regression guard: a
    // phase_type lookup (instead of sequence_number) would land on the first
    // `unloading` row regardless of which ones are actually resolved.
    const stops = [
      { trip_stop_id: 'stop-1', sequence: 1, picks_up: true, drops_off: false },
      { trip_stop_id: 'stop-2', sequence: 2, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-3', sequence: 3, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-4', sequence: 4, picks_up: false, drops_off: true },
    ]
    const plan = makePhasePlan('trip-3x-unloading', stops, '2026-01-01T00:00:00Z', 'test-3u')
    const unloadingRows = plan.filter((p) => p.phase_type === 'unloading')
    expect(unloadingRows).toHaveLength(3)

    // Resolve everything strictly before the third unloading — which also resolves
    // the departure/in_transit leg that sits between the second and third unloading,
    // since dropping off (without picking up) still departs for the next stop.
    const thirdUnloading = unloadingRows[2]
    const resolvedThroughBeforeThirdUnloading = walk(plan, thirdUnloading.sequence_number - 1)
    const current = currentPhase(resolvedThroughBeforeThirdUnloading)

    expect(current?.phase_event_id).toBe(thirdUnloading.phase_event_id)
    expect(current?.sequence_number).toBe(thirdUnloading.sequence_number)
  })

  it('is null once every phase is resolved — the trip is closed', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1].sequence_number)

    expect(currentPhase(plan)).toBeNull()
  })

  it('treats exception and overridden phases as resolved, so the walk does not stall on either', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map((p) => {
      if (p.sequence_number === 0) return { ...p, status: 'exception' as const }
      if (p.sequence_number === 1) return { ...p, status: 'overridden' as const }
      return p
    })

    expect(currentPhase(plan)?.sequence_number).toBe(2)
  })
})

describe('stepsFor', () => {
  it('is empty for a phase with no capture recipe', () => {
    const tripCreation = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'trip_creation')!

    expect(stepsFor(tripCreation)).toEqual([])
  })

  it('resolves the four unloading steps with display names from STEP_NAMES', () => {
    const unloading = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'unloading')!
    const steps = stepsFor(unloading)

    expect(steps).toHaveLength(STEP_NAMES.unloading.length)
    expect(steps.map((s) => s.displayName)).toEqual([...STEP_NAMES.unloading])
    expect(steps.every((s) => s.phase_event_id === unloading.phase_event_id)).toBe(true)
    expect(steps.map((s) => s.stepIndex)).toEqual(steps.map((_, i) => i))
  })
})

describe('planProgress', () => {
  it('reads total from the plan itself, not a constant', () => {
    expect(planProgress(SINGLE_LEG_PHASE_PLAN).total).toBe(SINGLE_LEG_PHASE_PLAN.length)
    expect(planProgress(CROSS_DOCK_PHASE_PLAN).total).toBe(CROSS_DOCK_PHASE_PLAN.length)
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(7)
    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(11)
  })

  it('counts resolved phases (completed/exception/overridden) as completed', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 5) // sequence 0..5 resolved = 6 rows

    expect(planProgress(plan)).toEqual({ completed: 6, total: 11 })
  })
})

describe('isAnchored', () => {
  it('is true for trip_creation, departure and confirmation', () => {
    const anchoredTypes = ['trip_creation', 'departure', 'confirmation'] as const
    for (const type of anchoredTypes) {
      const phase = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === type)!
      expect(isAnchored(phase)).toBe(true)
    }
  })

  it('is false for activation, loading, in_transit and unloading', () => {
    const unanchoredTypes = ['activation', 'loading', 'in_transit', 'unloading'] as const
    for (const type of unanchoredTypes) {
      const phase = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === type)!
      expect(isAnchored(phase)).toBe(false)
    }
  })
})
