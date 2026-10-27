import { describe, expect, it } from 'vitest'
import {
  CROSS_DOCK_PHASE_PLAN,
  makePhasePlan,
  SINGLE_LEG_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { STEP_NAMES } from '@shared/lib/constants/phase-meta'
import {
  actionablePhase, contextPhaseEventId, currentPhase, isAnchored, isDriving, isFinalPhase, isPhaseBlocked,
  planProgress, stepsFor,
} from '../derive'

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

describe('currentPhase', () => {
  it('is the sequence-0 row on a fully-pending single-leg plan', () => {
    const current = currentPhase(SINGLE_LEG_PHASE_PLAN)

    expect(current?.sequence_number).toBe(0)
  })

  it('returns row N+1 on the 13-row cross-dock plan with the first N resolved', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 8)
    const current = currentPhase(plan)

    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(13)
    expect(current?.sequence_number).toBe(9)
    expect(current?.phase_type).toBe('in_transit')
  })

  it('returns the THIRD unloading, not the first, when the first two are resolved', () => {
    const stops = [
      { trip_stop_id: 'stop-1', sequence: 1, picks_up: true, drops_off: false },
      { trip_stop_id: 'stop-2', sequence: 2, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-3', sequence: 3, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-4', sequence: 4, picks_up: false, drops_off: true },
    ]
    const plan = makePhasePlan('trip-3x-unloading', stops, '2026-01-01T00:00:00Z', 'test-3u')
    const unloadingRows = plan.filter((p) => p.phase_type === 'unloading')
    expect(unloadingRows).toHaveLength(3)

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

describe('actionablePhase', () => {
  it('agrees with currentPhase whenever the current row has steps of its own', () => {
    const activationSeq = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'activation')!.sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, activationSeq - 1)

    expect(actionablePhase(plan)?.phase_event_id).toBe(currentPhase(plan)?.phase_event_id)
  })

  it('skips the PENDING, driverless in_transit row and returns the arrival phase', () => {
    const departureSeq = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!.sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, departureSeq)

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(actionablePhase(plan)?.phase_type).toBe('arrival')
  })

  it('returns leg 2’s arrival, not leg 1’s, on a cross-dock plan', () => {
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)

    const actionable = actionablePhase(plan)

    expect(actionable?.phase_type).toBe('arrival')
    expect(actionable!.sequence_number).toBeGreaterThan(secondInTransit.sequence_number)
  })

  it('is null once no unresolved phase has any steps left', () => {
    const lastRow = SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1]

    expect(actionablePhase(walk(SINGLE_LEG_PHASE_PLAN, lastRow.sequence_number))).toBeNull()
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
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(8)
    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(13)
  })

  it('counts resolved phases (completed/exception/overridden) as completed', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 5)

    expect(planProgress(plan)).toEqual({ completed: 6, total: 13 })
  })
})

describe('isAnchored', () => {
  it('is true for every phase in the plan — every phase anchors since 2026-09-23', () => {
    for (const phase of SINGLE_LEG_PHASE_PLAN) {
      expect(isAnchored(phase)).toBe(true)
    }
  })
})

describe('isDriving', () => {
  it('is true while in_transit is itself the unresolved current phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(isDriving(plan)).toBe(true)
  })

  it('is false once in_transit resolves and the arrival phase is current', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4)

    expect(currentPhase(plan)?.phase_type).toBe('arrival')
    expect(isDriving(plan)).toBe(false)
  })

  it('is false when in_transit was overridden by the dispatcher', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3).map((p) =>
      p.phase_type === 'in_transit' ? { ...p, status: 'overridden' as const } : p,
    )

    expect(currentPhase(plan)?.phase_type).toBe('arrival')
    expect(isDriving(plan)).toBe(false)
  })

  it('is still true for the whole drive, before arrival is submitted', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)

    const inTransit = plan.find((p) => p.phase_type === 'in_transit')
    expect(inTransit?.status).toBe('pending')
    expect(isDriving(plan)).toBe(true)
  })

  it('is false before the trip has moved at all', () => {
    expect(isDriving(SINGLE_LEG_PHASE_PLAN)).toBe(false)
  })

  it('is false at loading, where the phase immediately behind is not an in_transit', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 1)

    expect(currentPhase(plan)?.phase_type).toBe('loading')
    expect(isDriving(plan)).toBe(false)
  })

  it('is false once the truck has arrived and unloading is resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 6)

    expect(currentPhase(plan)?.phase_type).toBe('confirmation')
    expect(isDriving(plan)).toBe(false)
  })

  it('is false on a closed trip with every phase resolved', () => {
    const last = SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1]
    const plan = walk(SINGLE_LEG_PHASE_PLAN, last.sequence_number)

    expect(currentPhase(plan)).toBeNull()
    expect(isDriving(plan)).toBe(false)
  })

  it('is false on an empty plan', () => {
    expect(isDriving([])).toBe(false)
  })

  it('fires on EVERY leg of a cross-dock plan, and stops the instant arrival is submitted', () => {
    const inTransitRows = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')
    const departureRows = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'departure')
    expect(inTransitRows).toHaveLength(2)
    expect(departureRows).toHaveLength(2)

    const drivingAt = CROSS_DOCK_PHASE_PLAN
      .map((phase) => phase.sequence_number)
      .filter((seq) => isDriving(walk(CROSS_DOCK_PHASE_PLAN, seq)))

    const expectedDriving = departureRows.map((p) => p.sequence_number).sort((a, b) => a - b)
    expect(drivingAt).toEqual(expectedDriving)
  })

  it('is true on the second leg while its own in_transit is the current phase', () => {
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(isDriving(plan)).toBe(true)
  })

  it('reads the plan by sequence_number, not by the order it arrived over the wire', () => {
    const driving = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const shuffled = [...driving].reverse()

    expect(isDriving(shuffled)).toBe(true)
  })

  it('is false once an EXCEPTION-closed in_transit hands off to arrival', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map((p) =>
      p.phase_type === 'in_transit' ? { ...p, status: 'exception' as const } : p,
    )

    expect(currentPhase(plan)?.phase_type).toBe('arrival')
    expect(isDriving(plan)).toBe(false)
  })
})

describe('contextPhaseEventId', () => {
  it('tags an on-the-road exception to in_transit, not to the arrival still ahead', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = plan.find((p) => p.phase_type === 'in_transit')

    expect(actionablePhase(plan)?.phase_type).toBe('arrival')
    expect(contextPhaseEventId(plan)).toBe(inTransit?.phase_event_id)
  })

  it('picks the leg being driven on a cross-dock plan, not the first in_transit', () => {
    const inTransitRows = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')
    const secondLeg = inTransitRows[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondLeg.sequence_number - 1)

    expect(inTransitRows).toHaveLength(2)
    expect(contextPhaseEventId(plan)).toBe(secondLeg.phase_event_id)
    expect(contextPhaseEventId(plan)).not.toBe(inTransitRows[0].phase_event_id)
  })

  it('reads by sequence_number, not the order rows arrived over the wire', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const shuffled = [...plan].reverse()

    expect(contextPhaseEventId(shuffled)).toBe(contextPhaseEventId(plan))
  })

  it('is null on a fully-resolved plan, leaving the backend to place it', () => {
    const closed = SINGLE_LEG_PHASE_PLAN.map((p) => ({ ...p, status: 'completed' as const }))

    expect(contextPhaseEventId(closed)).toBeNull()
  })

  it('is null on an empty plan', () => {
    expect(contextPhaseEventId([])).toBeNull()
  })
})

describe('isFinalPhase', () => {
  it('is true only for the last row of a single-leg plan', () => {
    const last = SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1]

    expect(isFinalPhase(SINGLE_LEG_PHASE_PLAN, last)).toBe(true)
    expect(SINGLE_LEG_PHASE_PLAN.filter((p) => isFinalPhase(SINGLE_LEG_PHASE_PLAN, p))).toHaveLength(1)
  })

  it('is false for the FIRST confirmation of a cross-dock plan', () => {
    const firstConfirmation = CROSS_DOCK_PHASE_PLAN.find((p) => p.phase_type === 'confirmation')
    const last = CROSS_DOCK_PHASE_PLAN[CROSS_DOCK_PHASE_PLAN.length - 1]

    expect(firstConfirmation).toBeDefined()
    expect(isFinalPhase(CROSS_DOCK_PHASE_PLAN, last)).toBe(true)
    if (firstConfirmation !== undefined && firstConfirmation.sequence_number !== last.sequence_number) {
      expect(isFinalPhase(CROSS_DOCK_PHASE_PLAN, firstConfirmation)).toBe(false)
    }
  })

  it('is false against an empty plan', () => {
    expect(isFinalPhase([], SINGLE_LEG_PHASE_PLAN[0])).toBe(false)
  })
})

describe('isPhaseBlocked', () => {
  const phase = SINGLE_LEG_PHASE_PLAN[0]

  it('is true when the server names what the phase waits on', () => {
    expect(isPhaseBlocked({ ...phase, blocked_on: 'warehouse_scan' })).toBe(true)
  })

  it('is false for null and for a fixture that omits the field', () => {
    const { blocked_on: _omitted, ...withoutField } = phase

    expect(isPhaseBlocked({ ...phase, blocked_on: null })).toBe(false)
    expect(isPhaseBlocked(withoutField)).toBe(false)
  })
})
