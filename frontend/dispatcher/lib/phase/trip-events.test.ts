import { describe, expect, it } from 'vitest'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { mockTrips } from '@shared/lib/mocks/trips'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import type { IncidentSummary } from '@/lib/types/incident'
import { incidentEventTime, positionTripEvents } from './trip-events'

const base = new Date('2026-10-20T08:00:00Z').getTime()
const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString()

function transfer(minutes: number, sequence = 1): CompletedSubstitutionSummary {
  return { substitution_id: `transfer-${sequence}`, request_id: null, sequence_number: sequence,
    outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming,
    effective_at: at(minutes), completion_mode: null, anchor_status: null, receipt_id: null, phase_context: null,
    request_format: null, required_confirmation_roles: null, confirmation_policy: null }
}

function incident(id: string, received: number, occurred: number | null = null): IncidentSummary {
  return { incident_id: id, reference: id.toUpperCase(), trip_id: 'trip', trip_reference: 'FP-1', trip_status: 'active',
    incident_type: 'hijacking', summary: 'Truck taken', status: 'open', confidence: 'reported', outcome: null,
    assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: occurred === null ? null : at(occurred),
    received_at: at(received), trip_stopped_at: null, closed_at: null, created_at: at(received), exception_ids: [],
    exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0 }
}

function phases(): PhaseDescriptor[] {
  return mockTrips[0]!.phases.slice(0, 4).map((p, index) => ({ ...p, status: 'completed', completed_at: at(index * 10) }))
}

describe('incidentEventTime', () => {
  it('prefers_when_the_reporter_says_it_happened_over_when_it_was_received', () => {
    expect(incidentEventTime(incident('inc', 30, 12))).toBe(at(12))
  })

  it('falls_back_to_the_received_time', () => {
    expect(incidentEventTime(incident('inc', 30))).toBe(at(30))
  })
})

describe('positionTripEvents', () => {
  it('places_an_incident_after_the_phase_it_followed_using_the_reported_time', () => {
    const plan = phases()
    const placed = positionTripEvents(plan, [], [incident('inc1', 35, 15)])

    expect(placed.afterPhase.get(plan[1].phase_event_id)?.map(e => e.kind)).toEqual(['incident'])
  })

  it('orders_a_transfer_and_an_incident_in_one_slot_by_time', () => {
    const plan = phases()
    const placed = positionTripEvents(plan, [transfer(26)], [incident('inc1', 22), incident('inc2', 28)])

    const slot = placed.afterPhase.get(plan[2].phase_event_id)!
    expect(slot.map(e => e.kind === 'incident' ? e.incident.incident_id : e.transfer.substitution_id))
      .toEqual(['inc1', 'transfer-1', 'inc2'])
  })

  it('reads_a_transfer_before_an_incident_at_the_same_instant', () => {
    const plan = phases()
    const placed = positionTripEvents(plan, [transfer(25)], [incident('inc1', 25)])

    expect(placed.afterPhase.get(plan[2].phase_event_id)?.map(e => e.kind)).toEqual(['transfer', 'incident'])
  })

  it('leaves_incidents_unplaced_when_the_plan_gives_no_consistent_boundaries', () => {
    const plan = phases()
    plan[1] = { ...plan[1], completed_at: null }

    expect(positionTripEvents(plan, [], [incident('inc1', 25)]).unplaced).toHaveLength(1)
  })

  it('keeps_an_incident_once_when_a_refresh_delivers_it_twice', () => {
    const plan = phases()
    const placed = positionTripEvents(plan, [], [incident('inc1', 25), incident('inc1', 25)])

    expect(placed.afterPhase.get(plan[2].phase_event_id)).toHaveLength(1)
  })
})
