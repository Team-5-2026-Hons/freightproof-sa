import { describe, expect, it } from 'vitest'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { mockTrips } from '@shared/lib/mocks/trips'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { positionDriverTransfers, positionTimelineEvents } from './driver-transfers'
const base = new Date('2026-10-20T08:00:00Z').getTime()
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString()
function event(minutes: number, sequence = 1): CompletedSubstitutionSummary {
  return { substitution_id: `transfer-${sequence}`, request_id: null, sequence_number: sequence,
    outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming,
    effective_at: at(minutes), completion_mode: null, anchor_status: null, receipt_id: null, phase_context: null,
    request_format: null, required_confirmation_roles: null, confirmation_policy: null }
}
function phases(): PhaseDescriptor[] {
  return mockTrips[0]!.phases.slice(0, 4).map((p, index) => ({ ...p, status: 'completed', completed_at: at(index * 10) }))
}
it('after_loading_transfer_precedes_departure', () => {
  const plan = phases()
  const placed = positionDriverTransfers(plan, [event(25)])
  expect(placed.afterPhase.get(plan[2].phase_event_id)?.map(e => e.substitution_id)).toEqual(['transfer-1'])
  expect(placed.unplaced).toEqual([])
})
it('during_transit_transfer_follows_departure_milestone', () => {
  const plan = phases()
  plan.push({ ...plan[3], phase_event_id: 'unfinished' as PhaseDescriptor['phase_event_id'], status: 'pending', completed_at: null, sequence_number: 4 })
  expect(positionDriverTransfers(plan, [event(35)]).afterPhase.get(plan[3].phase_event_id)).toHaveLength(1)
})
it('same_time_events_follow_sequence_and_survive_refresh', () => {
  const plan = phases()
  const placement = positionDriverTransfers(plan, [event(20, 2), event(20, 1), event(20, 1)])
  expect(placement.afterPhase.get(plan[2].phase_event_id)?.map(e => e.sequence_number)).toEqual([1, 2])
})
it('ambiguous_history_is_visible_without_invented_context', () => {
  const plan = phases()
  plan[1] = { ...plan[1], completed_at: null }
  expect(positionDriverTransfers(plan, [event(25)]).unplaced).toHaveLength(1)
})
it('requestless_legacy_is_placed_when_timestamps_prove_it', () => {
  expect(positionDriverTransfers(phases(), [event(15)]).afterPhase.size).toBe(1)
})

describe('positionTimelineEvents', () => {
  interface Note { id: string; when: string; rank?: number }
  const note = (id: string, minutes: number, rank = 0): Note => ({ id, when: at(minutes), rank })
  const place = (events: Note[]) => positionTimelineEvents(phases(), events, n => n.when, n => n.id, (a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  it('puts_an_event_before_the_first_resolved_phase_when_it_predates_it', () => {
    expect(place([note('early', -5)]).beforeFirst.map(n => n.id)).toEqual(['early'])
  })

  it('places_each_event_after_the_last_phase_that_finished_before_it', () => {
    const plan = phases()
    const placed = place([note('a', 15), note('b', 25)])
    expect(placed.afterPhase.get(plan[1].phase_event_id)?.map(n => n.id)).toEqual(['a'])
    expect(placed.afterPhase.get(plan[2].phase_event_id)?.map(n => n.id)).toEqual(['b'])
  })

  it('orders_a_shared_slot_by_time_then_tie_break_then_key_and_keeps_a_repeated_key_once', () => {
    const plan = phases()
    const placed = place([note('late', 28), note('z', 21, 1), note('y', 21, 0), note('x', 21, 0), note('x', 21, 0)])
    expect(placed.afterPhase.get(plan[2].phase_event_id)?.map(n => n.id)).toEqual(['x', 'y', 'z', 'late'])
  })

  it('leaves_everything_unplaced_when_the_phase_times_do_not_run_forward', () => {
    const plan = phases()
    plan[2] = { ...plan[2], completed_at: at(-30) }
    const placed = positionTimelineEvents(plan, [note('a', 25)], n => n.when, n => n.id)
    expect(placed.unplaced.map(n => n.id)).toEqual(['a'])
    expect(placed.afterPhase.size).toBe(0)
  })

  it('leaves_an_event_with_an_unreadable_time_unplaced', () => {
    expect(place([{ id: 'bad', when: 'not a date' }]).unplaced.map(n => n.id)).toEqual(['bad'])
  })
})
