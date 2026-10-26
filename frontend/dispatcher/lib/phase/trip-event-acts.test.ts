import { describe, expect, it } from 'vitest'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import { mockPrecincts, mockTrips, TRIP_0035_ID } from '@shared/lib/mocks'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'
import type { IncidentSummary } from '@/lib/types/incident'
import { withTripEventActs, type PhaseAct } from './acts'
import { buildPhaseCardModel } from './card'
import { tripEventReasons, type TripTimelineEvent } from './trip-events'

const T = (hhmm: string): string => `2026-10-25T${hhmm}:00Z`

function incident(id: string, at: string): TripTimelineEvent {
  const summary: IncidentSummary = { incident_id: id, reference: id.toUpperCase(), trip_id: 'trip', trip_reference: 'FP-1', trip_status: 'cancelled',
    incident_type: 'hijacking', summary: 'Driver activated panic button.', status: 'open', confidence: 'reported', outcome: null,
    assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: at, received_at: at, trip_stopped_at: null, closed_at: null,
    created_at: at, exception_ids: [], exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0 }
  return { kind: 'incident', incident: summary }
}

function transfer(at: string): TripTimelineEvent {
  const summary: CompletedSubstitutionSummary = { substitution_id: 'transfer-1', request_id: null, sequence_number: 1,
    outgoing: pack.outgoingPending.outgoing, incoming: pack.outgoingPending.incoming, effective_at: at, completion_mode: null,
    anchor_status: null, receipt_id: null, phase_context: null, request_format: null, required_confirmation_roles: null, confirmation_policy: null }
  return { kind: 'transfer', transfer: summary }
}

const departed: PhaseAct = { kind: 'milestone', key: 'departed', event: 'departed', at: T('11:52'), sealNumber: 'FP-1234' }
const panic: PhaseAct = { kind: 'exception', key: 'panic', exceptionId: 'panic', at: T('11:53'), trigger: 'event' }
const arrived: PhaseAct = { kind: 'completion', key: 'arrived', outcome: 'completed', confirmedAt: T('12:30'), recordedAt: T('12:30'),
  values: { sealNumber: null, sealCondition: null, parcelsScanned: null, driverVisualCount: null }, override: null }
const finding: PhaseAct = { kind: 'exception', key: 'finding', exceptionId: 'finding', at: T('12:31'), trigger: 'handshake' }
const enRoute: PhaseAct = { kind: 'expected', key: 'en-route', role: null, reason: 'en_route' }

const keys = (acts: readonly PhaseAct[]): string[] => acts.map(act => act.key)

describe('withTripEventActs', () => {
  it('puts_a_hijacking_after_the_panic_that_preceded_it', () => {
    const acts = withTripEventActs([departed, panic, enRoute], [incident('inc1', T('11:54'))])

    expect(keys(acts)).toEqual(['departed', 'panic', 'trip-event:incident:inc1', 'en-route'])
  })

  it('puts_a_transfer_before_the_arrival_it_preceded', () => {
    const acts = withTripEventActs([departed, arrived, finding], [transfer(T('12:29'))])

    expect(keys(acts)).toEqual(['departed', 'trip-event:transfer:transfer-1', 'arrived', 'finding'])
  })

  it('keeps_a_transfer_then_a_hijacking_in_time_order', () => {
    const acts = withTripEventActs([departed, panic], [transfer('2026-10-25T11:52:30Z'), incident('inc1', T('11:54'))])

    expect(keys(acts)).toEqual(['departed', 'trip-event:transfer:transfer-1', 'panic', 'trip-event:incident:inc1'])
  })

  it('leaves_the_rows_untouched_without_events', () => {
    expect(withTripEventActs([departed, panic, enRoute], [])).toEqual([departed, panic, enRoute])
  })
})

describe('tripEventReasons', () => {
  it('says_nothing_without_events', () => {
    expect(tripEventReasons([])).toEqual([])
  })

  it('names_incidents_first_then_the_transfer', () => {
    expect(tripEventReasons([transfer(T('11:53')), incident('inc1', T('11:54'))])).toEqual(['1 incident', 'Driver transferred'])
  })
})

describe('buildPhaseCardModel with trip events', () => {
  function inTransitOf(trip: Trip): PhaseDescriptor {
    const phase = trip.phases.find(candidate => candidate.phase_type === 'in_transit')
    if (!phase) throw new Error('in_transit phase is missing')
    return phase
  }

  it('adds_the_incident_to_the_rows_and_the_header', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0035_ID)!
    const phase = inTransitOf(trip)
    const at = phase.completed_at ?? T('11:54')

    const model = buildPhaseCardModel({ trip, phase, precincts: mockPrecincts, artifacts: [], exceptions: [], receipt: undefined,
      nowMs: Date.parse(T('13:00')), tripEvents: [incident('inc1', at)] })

    expect(model.acts.some(act => act.kind === 'trip_event')).toBe(true)
    expect(model.hasBody).toBe(true)
    expect(model.verdict?.reasons[0]).toBe('1 incident')
  })
})
