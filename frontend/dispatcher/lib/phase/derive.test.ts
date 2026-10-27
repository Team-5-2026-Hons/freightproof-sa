import { describe, expect, it } from 'vitest'
import {
  SINGLE_LEG_PHASE_PLAN,
  CROSS_DOCK_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import {
  activePhase, anchorTally, completionPct,
  currentSealNumber, departureSealForLeg, isResolved, legDepartureAt, nodeTypeFor, originScannedCount,
  recordedExceptionLabel, sortedPlan, tripChipMeta, destinationScannedCount,
} from './derive'
import type { TripException } from '@shared/lib/types/exception'

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map(p => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

describe('activePhase', () => {
  it('is the lowest-sequence unresolved phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2)

    expect(activePhase(plan)?.sequence_number).toBe(3)
  })

  it('is null when every phase is resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 7)

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

  it('does not pin to an exception phase — the backend has already moved past it', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)

    expect(activePhase(plan)?.sequence_number).toBe(5)
  })
})

describe('completionPct', () => {
  it('never exceeds 100 on a 13-phase plan', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 12)

    expect(plan).toHaveLength(13)
    expect(completionPct(plan)).toBe(100)
  })

  it('uses the plan its own length as the denominator, not a constant', () => {
    expect(completionPct(walk(CROSS_DOCK_PHASE_PLAN, 6))).toBe(54)
  })

  it('is 0 on an empty plan rather than NaN', () => {
    expect(completionPct([])).toBe(0)
  })

  it('reaches 100 on a closed trip that carries an exception phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 7).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)

    expect(completionPct(plan)).toBe(100)
  })
})

describe('nodeTypeFor', () => {
  it('marks an exception phase warn even though the status counts as resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)
    const active = activePhase(plan)

    expect(nodeTypeFor(plan[3], active?.phase_event_id ?? null)).toBe('warn')
  })

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
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 9).map(p =>
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
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)
    const unloading = plan.find(p => p.sequence_number === 11)!

    expect(departureSealForLeg(plan, unloading)).toBe('AB-2222')
  })

  it('does not reach past its own leg into a later departure', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)
    const unloading = plan.find(p => p.sequence_number === 6)!

    expect(departureSealForLeg(plan, unloading)).toBe('AB-1111')
  })

  it("is null when this leg's own departure recorded no seal, not an earlier leg's seal", () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'A' : null }
        : p)
    const unloading = plan.find(p => p.sequence_number === 11)!

    expect(departureSealForLeg(plan, unloading)).toBeNull()
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
      if (p.sequence_number === 7) return { ...p, parcel_count_origin: 7 }
      return p
    })

    expect(originScannedCount(plan)).toBe(40)
  })
})

describe('destinationScannedCount', () => {
  it('reads the confirmation row — the only phase the backend ever writes the count on', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p => {
      if (p.phase_type === 'unloading') return { ...p, parcel_count_destination: 99 }
      if (p.phase_type === 'confirmation') return { ...p, parcel_count_destination: 38 }
      return p
    })

    expect(destinationScannedCount(plan)).toBe(38)
  })

  it('ignores both unloading rows of a cross-dock', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p => (
      p.phase_type === 'unloading' ? { ...p, parcel_count_destination: 99 } : p
    ))

    expect(destinationScannedCount(plan)).toBeNull()
  })

  it('is null until delivery is confirmed — an unrecorded count is not a count of zero', () => {
    expect(destinationScannedCount(SINGLE_LEG_PHASE_PLAN)).toBeNull()
  })
})

describe('anchorTally', () => {
  it('counts receipts owed from anchor_status, never from plan length', () => {
    expect(anchorTally(SINGLE_LEG_PHASE_PLAN).owed).toBe(8)
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(8)
  })

  it('surfaces a failed anchor separately from an anchored one', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p => {
      if (p.sequence_number === 0) return { ...p, anchor_status: 'anchored' as const }
      if (p.sequence_number === 3) return { ...p, anchor_status: 'failed' as const }
      return p
    })

    expect(anchorTally(plan)).toEqual({ owed: 8, anchored: 1, failed: 1 })
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

    expect(meta.label).toBe('⚠ Unloading')
    expect(meta.chipType).toBe('exception')
  })

  it('leaves terminal and pre-start states alone', () => {
    expect(tripChipMeta('created', 'activation').label).toBe('Created')
    expect(tripChipMeta('closed', null).label).toBe('Complete')
    expect(tripChipMeta('cancelled', null).label).toBe('Cancelled')
  })

  it('never produces a label longer than the widest one it renders today', () => {
    const widest = (['activation', 'loading', 'departure', 'in_transit', 'unloading',
                     'confirmation'] as const)
      .flatMap(phase => [tripChipMeta('active', phase), tripChipMeta('exception_hold', phase)])
      .reduce((max, meta) => Math.max(max, meta.label.length), 0)

    expect(widest).toBeLessThanOrEqual(14)
  })

  it('degrades to the coarse label rather than undefined when the cache is empty', () => {
    expect(tripChipMeta('active', null).label).toBe('Active')
    expect(tripChipMeta('active', null).chipType).toBe('transit')
    expect(tripChipMeta('exception_hold', null).label).toBe('Exception')
  })
})

describe('legDepartureAt', () => {
  function complete(
    plan: readonly PhaseDescriptor[], sequenceNumber: number, at: string,
  ): PhaseDescriptor[] {
    return plan.map(p =>
      p.sequence_number === sequenceNumber
        ? { ...p, status: 'completed' as const, completed_at: at }
        : p)
  }

  it('reads the departure that started this leg, never the in-transit row own created_at', () => {
    const plan = complete(SINGLE_LEG_PHASE_PLAN, 3, '2026-07-27T14:00:00Z')
    const inTransit = plan.find(p => p.phase_type === 'in_transit')!

    expect(inTransit.created_at).toBe('2026-07-27T08:00:00Z')
    expect(legDepartureAt(plan, inTransit)).toBe('2026-07-27T14:00:00Z')
  })

  it('scopes to the leg — leg 2 is dated from its own departure, not leg 1 s', () => {
    let plan = complete(CROSS_DOCK_PHASE_PLAN, 3, '2026-07-27T14:00:00Z')
    plan = complete(plan, 8, '2026-07-27T19:30:00Z')
    const secondLeg = plan.find(p => p.phase_type === 'in_transit' && p.sequence_number === 9)!

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
    ({ id } as unknown as TripException)

  it('is null on a clean trip', () => {
    expect(recordedExceptionLabel([], SINGLE_LEG_PHASE_PLAN)).toBeNull()
  })

  it('counts records and pluralises', () => {
    expect(recordedExceptionLabel([exception('a')], SINGLE_LEG_PHASE_PLAN)).toBe('1 exception')
    expect(recordedExceptionLabel([exception('a'), exception('b')], SINGLE_LEG_PHASE_PLAN)).toBe('2 exceptions')
  })

  it('counts a reviewed record as an exception fact', () => {
    const reviewed = { ...exception('a'), review_status: 'reviewed' as const }

    expect(recordedExceptionLabel([reviewed], SINGLE_LEG_PHASE_PLAN)).toBe('1 exception')
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

  it('treats completed, exception and overridden as resolved and nothing else', () => {
    const of = (status: PhaseDescriptor['status']) => isResolved({ ...SINGLE_LEG_PHASE_PLAN[0], status })

    expect(of('completed')).toBe(true)
    expect(of('overridden')).toBe(true)
    expect(of('exception')).toBe(true)
    expect(of('pending')).toBe(false)
    expect(of('in_progress')).toBe(false)
  })
})
