import { describe, it, expect } from 'vitest'
import { deliveredSummary } from '../delivered-summary'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

const arrivalSeq = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'arrival')!.sequence_number

function tripWith(phases: PhaseDescriptor[], plannedArrival: string | null): Trip {
  return { phases, planned_arrival_at: plannedArrival, actual_arrival_at: null } as unknown as Trip
}

function arrivedAt(iso: string, anchoredThrough = 0): PhaseDescriptor[] {
  return SINGLE_LEG_PHASE_PLAN.map((p) => ({
    ...p,
    status: p.sequence_number <= arrivalSeq ? 'completed' as const : p.status,
    completed_at: p.phase_type === 'arrival' ? iso : p.completed_at,
    anchor_status: p.sequence_number <= anchoredThrough ? 'anchored' as const : 'pending' as const,
  }))
}

describe('deliveredSummary', () => {
  it('test_reads_on_time_when_arrival_is_by_the_planned_time', () => {
    const summary = deliveredSummary(tripWith(arrivedAt('2026-10-14T17:24:00Z'), '2026-10-14T17:30:00Z'))

    expect(summary.arrivedAt).toBe('2026-10-14T17:24:00Z')
    expect(summary.onTime).toBe(true)
  })

  it('test_reads_late_after_the_planned_time_with_no_grace', () => {
    expect(deliveredSummary(tripWith(arrivedAt('2026-10-14T17:31:00Z'), '2026-10-14T17:30:00Z')).onTime).toBe(false)
  })

  it('test_makes_no_on_time_claim_without_a_plan', () => {
    expect(deliveredSummary(tripWith(arrivedAt('2026-10-14T17:31:00Z'), null)).onTime).toBeNull()
  })

  it('test_counts_anchored_driver_phases_out_of_all_of_them', () => {
    const summary = deliveredSummary(tripWith(arrivedAt('2026-10-14T17:24:00Z', 3), null))

    expect(summary.total).toBe(SINGLE_LEG_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation').length)
    expect(summary.anchored).toBe(SINGLE_LEG_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation' && p.sequence_number <= 3).length)
  })
})
