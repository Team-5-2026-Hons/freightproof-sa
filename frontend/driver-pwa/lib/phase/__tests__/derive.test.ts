import { describe, expect, it } from 'vitest'
import {
  CROSS_DOCK_PHASE_PLAN,
  makePhasePlan,
  SINGLE_LEG_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { STEP_NAMES } from '@shared/lib/constants/phase-meta'
import {
  actionablePhase, contextPhaseEventId, currentPhase, isAnchored, isDriving, planProgress, stepsFor,
} from '../derive'

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

describe('actionablePhase', () => {
  it('agrees with currentPhase whenever the current row has steps of its own', () => {
    const activationSeq = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'activation')!.sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, activationSeq - 1)

    expect(actionablePhase(plan)?.phase_event_id).toBe(currentPhase(plan)?.phase_event_id)
  })

  it('skips the PENDING, driverless in_transit row and returns the arrival phase', () => {
    // The whole reason this function exists. During the drive the LEDGER is on
    // in_transit, but the driver's next action is unloading — and asking currentPhase
    // for "what does the driver do next" is what deadlocked the arrival step.
    const departureSeq = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!.sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, departureSeq)

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(actionablePhase(plan)?.phase_type).toBe('unloading')
  })

  it('returns leg 2’s unloading, not leg 1’s, on a cross-dock plan', () => {
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)

    const actionable = actionablePhase(plan)

    expect(actionable?.phase_type).toBe('unloading')
    // Proves the sequence walk, not a phase_type lookup: leg 1's unloading sits earlier
    // in this same plan and is already resolved.
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

describe('isDriving', () => {
  // The backend keeps in_transit PENDING for exactly as long as the truck is moving —
  // opened by departure, closed only by the driver's own arrival submission — so the
  // single rule is: driving iff the ledger's current row is an unresolved in_transit.
  it('is true while in_transit is itself the unresolved current phase', () => {
    // Departure is done, driver is actively on the road until arrival, so in_transit
    // is shown to the driver as the current phase. This is when the driving screen appears.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // through departure

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(isDriving(plan)).toBe(true)
  })

  it('is false once arrival is recorded and unloading is current', () => {
    // Before driver-submitted arrival, in_transit could never be resolved while unloading
    // was current — that state was unreachable, so "unloading after a resolved in_transit"
    // was a safe (if accidental) proxy for driving. Arrival submission makes this the
    // NORMAL state of standing at the destination doing seal-verify: the exact moment the
    // driver is not driving. Keeping the old proxy here would have shown "Continue driving"
    // for the entire unloading phase.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4) // through in_transit — arrival submitted

    expect(currentPhase(plan)?.phase_type).toBe('unloading')
    expect(isDriving(plan)).toBe(false)
  })

  it('is false when an arrival was overridden by the dispatcher', () => {
    // The lost-phone recovery path — a dispatcher closed the leg on the driver's behalf.
    // The trip is not driving; it is exactly as "arrived" as a driver-submitted one.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3).map((p) =>
      p.phase_type === 'in_transit' ? { ...p, status: 'overridden' as const } : p,
    )

    expect(currentPhase(plan)?.phase_type).toBe('unloading')
    expect(isDriving(plan)).toBe(false)
  })

  it('is still true for the whole drive, before arrival is submitted', () => {
    // Departure has landed and in_transit is PENDING (not yet resolved by any means) —
    // the driver is mid-leg and has submitted nothing yet.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // through departure only

    const inTransit = plan.find((p) => p.phase_type === 'in_transit')
    expect(inTransit?.status).toBe('pending')
    expect(isDriving(plan)).toBe(true)
  })

  it('is false before the trip has moved at all', () => {
    expect(isDriving(SINGLE_LEG_PHASE_PLAN)).toBe(false)
  })

  it('is false at loading, where the phase immediately behind is not an in_transit', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 1) // through activation

    expect(currentPhase(plan)?.phase_type).toBe('loading')
    expect(isDriving(plan)).toBe(false)
  })

  it('is false once the truck has arrived and unloading is resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 5) // through unloading

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
    // Walking the plan one sequence number at a time and recording where isDriving fires:
    // it should flip true the moment each departure resolves (in_transit becomes current,
    // pending) and flip back false the moment that in_transit itself resolves (unloading
    // becomes current) — never firing on the unloading rows themselves. One true position
    // per leg, at the departure row, not two.
    const inTransitRows = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')
    const departureRows = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'departure')
    expect(inTransitRows).toHaveLength(2)
    expect(departureRows).toHaveLength(2)

    const drivingAt = CROSS_DOCK_PHASE_PLAN
      .map((phase) => phase.sequence_number)
      .filter((seq) => isDriving(walk(CROSS_DOCK_PHASE_PLAN, seq)))

    // Resolving through a departure row leaves its in_transit row as the pending current
    // phase — driving. Resolving through the in_transit row itself leaves unloading as
    // current — arrival has been submitted, no longer driving. So only the departure
    // sequence numbers should report driving, one per leg.
    const expectedDriving = departureRows.map((p) => p.sequence_number).sort((a, b) => a - b)
    expect(drivingAt).toEqual(expectedDriving)
  })

  it('is true on the second leg while its own in_transit is the current phase', () => {
    // The driver is driving on the second leg, so the second in_transit is shown as
    // the current phase. This correctly identifies both legs as driving times.
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)

    expect(currentPhase(plan)?.phase_type).toBe('in_transit')
    expect(isDriving(plan)).toBe(true)
  })

  it('reads the plan by sequence_number, not by the order it arrived over the wire', () => {
    // Same driving trip, rows shuffled. Plan order is never trusted off the wire.
    const driving = walk(SINGLE_LEG_PHASE_PLAN, 3) // through departure — in_transit pending, current
    const shuffled = [...driving].reverse()

    expect(isDriving(shuffled)).toBe(true)
  })

  it('is false once an EXCEPTION-closed in_transit hands off to unloading', () => {
    // 'exception' is a resolved status (the backend has moved past the row) same as
    // 'completed' or 'overridden' — a broken seal found on the road still closes the leg.
    // Whichever way in_transit was resolved, once unloading is current the driver has
    // stopped, so this must be false exactly like the 'completed' and 'overridden' cases
    // above — there is no resolution reason that keeps the driving screen up.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map((p) =>
      p.phase_type === 'in_transit' ? { ...p, status: 'exception' as const } : p,
    )

    expect(currentPhase(plan)?.phase_type).toBe('unloading')
    expect(isDriving(plan)).toBe(false)
  })
})

describe('contextPhaseEventId', () => {
  it('tags an on-the-road exception to in_transit, not to the arrival still ahead', () => {
    // The case the whole thing exists for. Everything through departure is resolved, so
    // in_transit is the current row while the driver's NEXT action is unloading. A panic
    // pressed here belongs to the drive; actionablePhase would say unloading and be wrong.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = plan.find((p) => p.phase_type === 'in_transit')

    expect(actionablePhase(plan)?.phase_type).toBe('unloading')
    expect(contextPhaseEventId(plan)).toBe(inTransit?.phase_event_id)
  })

  it('picks the leg being driven on a cross-dock plan, not the first in_transit', () => {
    // An 11-row plan carries two in_transit rows. Resolution is by sequence_number, so a
    // phase_type match alone would file a second-leg breakdown against the first leg.
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
