import { describe, expect, it } from 'vitest'
import {
  SINGLE_LEG_PHASE_PLAN,
  CROSS_DOCK_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import {
  activePhase, anchorTally, chainNodesFromCounts, completionPct,
  currentSealNumber, departureSealForLeg, isResolved, legDepartureAt, nodeTypeFor, originScannedCount,
  recordedExceptionLabel, sortedPlan, tripChipMeta,
} from './derive'
import type { TripException } from '@shared/lib/types/exception'

// Marks phases 0..through as completed. Local to the test on purpose: the module
// under test must not gain a helper that only tests use.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map(p => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

describe('activePhase', () => {
  it('is the lowest-sequence unresolved phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2)

    expect(activePhase(plan)?.sequence_number).toBe(3)
  })

  it('is null when every phase is resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 6)

    expect(activePhase(plan)).toBeNull()
  })

  it('ignores array order — the ledger is ordered by sequence_number, not by arrival', () => {
    const shuffled = [...walk(SINGLE_LEG_PHASE_PLAN, 2)].reverse()

    expect(activePhase(shuffled)?.sequence_number).toBe(3)
  })

  it('treats an overridden phase as resolved', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p =>
      p.sequence_number === 0 ? { ...p, status: 'overridden' as const } : p)

    expect(activePhase(plan)?.sequence_number).toBe(1)
  })

  // A departure that raised a seal mismatch does not hold the trip server-side, so it
  // must not hold the dispatcher's idea of "current" either — otherwise the header chip
  // names Departure while the driver is hours down the N3.
  it('does not pin to an exception phase — the backend has already moved past it', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)

    expect(activePhase(plan)?.sequence_number).toBe(5)
  })
})

describe('completionPct', () => {
  it('never exceeds 100 on an 11-phase plan', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 10)

    expect(plan).toHaveLength(11)
    expect(completionPct(plan)).toBe(100)
  })

  it('uses the plan its own length as the denominator, not a constant', () => {
    // 6 of 11 done is 55%. Against a hard-coded denominator of 6 it would be 100%.
    expect(completionPct(walk(CROSS_DOCK_PHASE_PLAN, 5))).toBe(55)
  })

  it('is 0 on an empty plan rather than NaN', () => {
    expect(completionPct([])).toBe(0)
  })

  // A trip that closed with a recorded exception is 100% done — the phase happened, the
  // anomaly is evidence attached to it, not outstanding work. Reporting 86% on a
  // delivered load reads as an unfinished trip on the board.
  it('reaches 100 on a closed trip that carries an exception phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 6).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)

    expect(completionPct(plan)).toBe(100)
  })
})

describe('nodeTypeFor', () => {
  // Guards the check ORDER in nodeTypeFor. `exception` is a resolved status, so if the
  // isResolved test ran first this would return 'done' and a seal mismatch would render
  // as ordinary green progress.
  it('marks an exception phase warn even though the status counts as resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)
    const active = activePhase(plan)

    expect(nodeTypeFor(plan[3], active?.phase_event_id ?? null)).toBe('warn')
  })

  // The regression this whole change exists to kill: on a trip whose departure raised a
  // seal mismatch, the row the driver is actually on must still be the `next` row. When
  // it fell through to 'pending', page.tsx read that as isPending and suppressed
  // alwaysExpandedContent — deleting the in-transit Journey card for the entire drive.
  it('still marks the genuinely-next row `next` when an earlier phase is an exception', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)
    const active = activePhase(plan)

    expect(active?.sequence_number).toBe(5)
    expect(nodeTypeFor(plan[5], active?.phase_event_id ?? null)).toBe('next')
  })

  it('marks resolved, next and pending phases distinctly', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2)
    const activeId = activePhase(plan)?.phase_event_id ?? null

    expect(nodeTypeFor(plan[2], activeId)).toBe('done')
    // The ledger's current gate, but still `pending` — nothing has actually
    // started, so this must not read as `active`.
    expect(nodeTypeFor(plan[3], activeId)).toBe('next')
    expect(nodeTypeFor(plan[4], activeId)).toBe('pending')
  })

  it('marks the current phase active only once it is genuinely in_progress', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'in_progress' as const } : p)
    const activeId = activePhase(plan)?.phase_event_id ?? null

    expect(nodeTypeFor(plan[3], activeId)).toBe('active')
  })

  it('keeps activation pending, not next, while the trip has not been activated', () => {
    // A trip created weeks ahead sits dormant — activation is not "about to happen",
    // so it must render indistinguishably from a phase that has not been reached yet.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0)
    const activationPhase = plan.find(p => p.phase_type === 'activation')!
    const activeId = activePhase(plan)?.phase_event_id ?? null

    expect(nodeTypeFor(activationPhase, activeId, 'created')).toBe('pending')
  })

  it('lets activation read as next once the trip is genuinely active', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0)
    const activationPhase = plan.find(p => p.phase_type === 'activation')!
    const activeId = activePhase(plan)?.phase_event_id ?? null

    expect(nodeTypeFor(activationPhase, activeId, 'active')).toBe('next')
  })
})

describe('currentSealNumber', () => {
  it('is the highest-sequence completed departure — the seal actually on the vehicle', () => {
    // Cross-dock: two departures (seq 3 and 7). Leg 1 is sealed and done, leg 2 is
    // sealed and done, so the current seal is leg 2 s.
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 8).map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)

    expect(currentSealNumber(plan)).toBe('AB-2222')
  })

  it('ignores a seal on a departure that has not completed', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.sequence_number === 3 ? { ...p, seal_number: 'AB-1111' } : p)

    expect(currentSealNumber(plan)).toBeNull()
  })

  // The driver applied and photographed this seal; the guard's re-entry is what
  // disagreed. It is the seal physically on the truck, and blanking it on a mismatch
  // hides the number from the one reader most likely to need it.
  it('reports the seal from a departure that raised a mismatch exception', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map(p =>
      p.sequence_number === 3
        ? { ...p, status: 'exception' as const, seal_number: 'AB-1234' }
        : p)

    expect(currentSealNumber(plan)).toBe('AB-1234')
  })
})

describe('departureSealForLeg', () => {
  it("is the seal from THIS leg's own departure, not an earlier leg's", () => {
    // Cross-dock: departures at seq 3 (leg 1) and seq 7 (leg 2). Leg 2's unloading
    // (seq 9) must compare against leg 2's own seal, never leg 1's.
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)
    const unloading = plan.find(p => p.sequence_number === 9)!

    expect(departureSealForLeg(plan, unloading)).toBe('AB-2222')
  })

  it('does not reach past its own leg into a later departure', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)
    const unloading = plan.find(p => p.sequence_number === 5)!

    expect(departureSealForLeg(plan, unloading)).toBe('AB-1111')
  })

  it('is null when no preceding departure has recorded a seal yet', () => {
    const unloading = SINGLE_LEG_PHASE_PLAN.find(p => p.phase_type === 'unloading')!

    expect(departureSealForLeg(SINGLE_LEG_PHASE_PLAN, unloading)).toBeNull()
  })
})

describe('originScannedCount', () => {
  it('is the lowest-sequence loading — the origin pickup, not the hub pickup', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p => {
      if (p.sequence_number === 2) return { ...p, parcel_count_origin: 40 }
      if (p.sequence_number === 6) return { ...p, parcel_count_origin: 7 }
      return p
    })

    expect(originScannedCount(plan)).toBe(40)
  })
})

describe('anchorTally', () => {
  it('counts receipts owed from anchor_status, never from plan length', () => {
    // A single-leg plan owes three: trip_creation, departure, confirmation.
    expect(anchorTally(SINGLE_LEG_PHASE_PLAN).owed).toBe(3)
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(7)
  })

  it('surfaces a failed anchor separately from an anchored one', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p => {
      if (p.sequence_number === 0) return { ...p, anchor_status: 'anchored' as const }
      if (p.sequence_number === 3) return { ...p, anchor_status: 'failed' as const }
      return p
    })

    expect(anchorTally(plan)).toEqual({ owed: 3, anchored: 1, failed: 1 })
  })
})

describe('chainNodesFromCounts', () => {
  it('renders one node per phase in the plan, however long the plan is', () => {
    expect(chainNodesFromCounts(11, 6, 'Unloading')).toHaveLength(11)
    expect(chainNodesFromCounts(7, 7, 'Confirmation')).toHaveLength(7)
  })

  it('marks completed, current and pending nodes', () => {
    const nodes = chainNodesFromCounts(11, 6, 'Unloading')

    expect(nodes[5].status).toBe('completed')
    expect(nodes[6].status).toBe('in_progress')
    expect(nodes[6].label).toBe('Unloading')
    expect(nodes[7].status).toBe('pending')
  })

  it('has no in-progress node on a fully walked plan', () => {
    expect(chainNodesFromCounts(7, 7, 'Confirmation').every(n => n.status === 'completed')).toBe(true)
  })

  it('is empty rather than throwing when the plan count is 0', () => {
    expect(chainNodesFromCounts(0, 0, '')).toEqual([])
  })
})

describe('tripChipMeta', () => {
  it('names the phase on an active trip, not the word "Active"', () => {
    const meta = tripChipMeta('active', 'unloading')

    expect(meta.label).toBe('Unloading')
    expect(meta.chipType).toBe('transit')
  })

  it('names the phase behind a warning prefix on a held trip, and stays amber', () => {
    const meta = tripChipMeta('exception_hold', 'unloading')

    // Both facts: that it is held, and where it stopped.
    expect(meta.label).toBe('⚠ Unloading')
    expect(meta.chipType).toBe('exception')
  })

  it('leaves terminal and pre-start states alone', () => {
    expect(tripChipMeta('created', 'activation').label).toBe('Created')
    expect(tripChipMeta('closed', null).label).toBe('Complete')
    expect(tripChipMeta('cancelled', null).label).toBe('Cancelled')
  })

  it('never produces a label longer than the widest one it renders today', () => {
    // 'At Origin Gate' is 14 chars. Chip has no fixed width, but ChecklistRow's
    // STATUS column is a fixed 120px, so a regression here would clip silently.
    const widest = (['activation', 'loading', 'departure', 'in_transit', 'unloading',
                     'confirmation'] as const)
      .flatMap(phase => [tripChipMeta('active', phase), tripChipMeta('exception_hold', phase)])
      .reduce((max, meta) => Math.max(max, meta.label.length), 0)

    expect(widest).toBeLessThanOrEqual(14)
  })

  it('degrades to the coarse label rather than undefined when the cache is empty', () => {
    // Live defect #4 was TRIP_STATUS_META[status] returning undefined and the caller
    // reading .chipType off it. This must never throw, whatever the cache holds.
    expect(tripChipMeta('active', null).label).toBe('Active')
    expect(tripChipMeta('active', null).chipType).toBe('transit')
    expect(tripChipMeta('exception_hold', null).label).toBe('Exception')
  })
})

describe('legDepartureAt', () => {
  // Marks one row completed at a given instant, leaving every other row untouched.
  function complete(
    plan: readonly PhaseDescriptor[], sequenceNumber: number, at: string,
  ): PhaseDescriptor[] {
    return plan.map(p =>
      p.sequence_number === sequenceNumber
        ? { ...p, status: 'completed' as const, completed_at: at }
        : p)
  }

  it('reads the departure that started this leg, never the in-transit row own created_at', () => {
    // The bug this exists to kill: created_at on every row is plan-generation time, so
    // the timeline printed a departure BEFORE the trip was created.
    const plan = complete(SINGLE_LEG_PHASE_PLAN, 3, '2026-07-27T14:00:00Z')
    const inTransit = plan.find(p => p.phase_type === 'in_transit')!

    expect(inTransit.created_at).toBe('2026-07-27T08:00:00Z')
    expect(legDepartureAt(plan, inTransit)).toBe('2026-07-27T14:00:00Z')
  })

  it('scopes to the leg — leg 2 is dated from its own departure, not leg 1 s', () => {
    // Cross-dock: departure at seq 3 (stop 1) and seq 7 (stop 2). The in-transit row at
    // seq 8 belongs to the SECOND leg and must never inherit the first departure time.
    let plan = complete(CROSS_DOCK_PHASE_PLAN, 3, '2026-07-27T14:00:00Z')
    plan = complete(plan, 7, '2026-07-27T19:30:00Z')
    const secondLeg = plan.find(p => p.phase_type === 'in_transit' && p.sequence_number === 8)!

    expect(legDepartureAt(plan, secondLeg)).toBe('2026-07-27T19:30:00Z')
  })

  it('is null while the leg departure is still pending rather than inventing a time', () => {
    const inTransit = SINGLE_LEG_PHASE_PLAN.find(p => p.phase_type === 'in_transit')!

    expect(legDepartureAt(SINGLE_LEG_PHASE_PLAN, inTransit)).toBeNull()
  })

  it('ignores array order', () => {
    const plan = complete(SINGLE_LEG_PHASE_PLAN, 3, '2026-07-27T14:00:00Z')
    const inTransit = plan.find(p => p.phase_type === 'in_transit')!

    expect(legDepartureAt([...plan].reverse(), inTransit)).toBe('2026-07-27T14:00:00Z')
  })
})

describe('recordedExceptionLabel', () => {
  const exception = (id: string): TripException =>
    ({ id, resolved: false } as unknown as TripException)

  it('is null on a clean trip', () => {
    expect(recordedExceptionLabel([], SINGLE_LEG_PHASE_PLAN)).toBeNull()
  })

  it('counts records and pluralises', () => {
    expect(recordedExceptionLabel([exception('a')], SINGLE_LEG_PHASE_PLAN)).toBe('1 exception')
    expect(recordedExceptionLabel([exception('a'), exception('b')], SINGLE_LEG_PHASE_PLAN)).toBe('2 exceptions')
  })

  it('counts a record regardless of resolved state — there is no resolve workflow yet', () => {
    const resolved = { ...exception('a'), resolved: true }

    expect(recordedExceptionLabel([resolved], SINGLE_LEG_PHASE_PLAN)).toBe('1 exception')
  })

  it('reports a held phase carrying no record rather than reading as clean', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p =>
      p.sequence_number === 5 ? { ...p, status: 'exception' as const } : p)

    expect(recordedExceptionLabel([], plan)).toBe('Exception')
  })
})

describe('sortedPlan / isResolved', () => {
  it('does not mutate its input', () => {
    const input = [...CROSS_DOCK_PHASE_PLAN].reverse()
    const before = input.map(p => p.sequence_number)

    sortedPlan(input)

    expect(input.map(p => p.sequence_number)).toEqual(before)
  })

  // The status list here must stay identical to phase_service._is_resolved. The two
  // surfaces disagreeing about "resolved" is not a cosmetic drift — it moved the active
  // phase, capped completion below 100% and suppressed the in-transit Journey card.
  it('treats completed, exception and overridden as resolved and nothing else', () => {
    const of = (status: PhaseDescriptor['status']) => isResolved({ ...SINGLE_LEG_PHASE_PLAN[0], status })

    expect(of('completed')).toBe(true)
    expect(of('overridden')).toBe(true)
    expect(of('exception')).toBe(true)
    expect(of('pending')).toBe(false)
    expect(of('in_progress')).toBe(false)
  })
})
