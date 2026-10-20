import { expect, it } from 'vitest'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { mockTrips } from '@shared/lib/mocks/trips'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import { positionDriverTransfers } from './driver-transfers'
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
