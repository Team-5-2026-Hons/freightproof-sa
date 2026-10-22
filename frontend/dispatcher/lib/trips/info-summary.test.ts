import { describe, expect, it } from 'vitest'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import type { Trip } from '@shared/lib/types/trip'
import type { IncidentSummary } from '@/lib/types/incident'
import { precinctLabel } from '@/lib/phase/trip-detail'
import {
  custodySummary, hasActiveIncident, hasPendingTransfer, incidentsSummary, leadingActiveIncidentStatus, routeSummary, scheduleSummary,
} from './info-summary'

const base: Trip = { ...mockTrips[0]!, status: 'active', closed_at: null }
const trip = (overrides: Partial<Trip>): Trip => ({ ...base, ...overrides })
const incident = (status: IncidentSummary['status']): IncidentSummary => ({ incident_id: status, status }) as IncidentSummary

describe('scheduleSummary', () => {
  const planned = '2026-10-20T08:00:00Z'

  it('says_how_late_the_trip_left', () => {
    expect(scheduleSummary(trip({ planned_departure_at: planned, actual_departure_at: '2026-10-20T09:11:00Z' }))).toBe('Departed 1 h 11 m late')
  })

  it('says_when_it_left_on_time_and_when_early', () => {
    expect(scheduleSummary(trip({ planned_departure_at: planned, actual_departure_at: planned }))).toBe('Departed on time')
    expect(scheduleSummary(trip({ planned_departure_at: planned, actual_departure_at: '2026-10-20T07:20:00Z' }))).toBe('Departed 40 m early')
  })

  it('says_not_departed_before_departure', () => {
    expect(scheduleSummary(trip({ actual_departure_at: null }))).toBe('Not departed')
  })

  it('names_the_end_of_a_closed_or_cancelled_trip_instead', () => {
    expect(scheduleSummary(trip({ status: 'closed', closed_at: '2026-10-21T10:00:00Z' }))).toBe('Closed 21 Oct 2026')
    expect(scheduleSummary(trip({ status: 'cancelled', closed_at: '2026-10-21T10:00:00Z' }))).toBe('Cancelled 21 Oct 2026')
    expect(scheduleSummary(trip({ status: 'cancelled', closed_at: null }))).toBe('Cancelled')
  })
})

describe('routeSummary', () => {
  it('counts_the_stops_and_names_both_ends', () => {
    const stops = [...base.stops].sort((a, b) => a.sequence - b.sequence)
    const name = (id: string) => precinctLabel(mockPrecincts.find(p => p.id === id))

    expect(routeSummary(base, mockPrecincts)).toBe(`${stops.length} stops · ${name(stops[0]!.precinct_id)} → ${name(stops.at(-1)!.precinct_id)}`)
  })

  it('uses_the_singular_and_survives_a_trip_with_no_stops', () => {
    expect(routeSummary(trip({ stops: [base.stops[0]!] }), mockPrecincts)).toMatch(/^1 stop · /)
    expect(routeSummary(trip({ stops: [] }), mockPrecincts)).toBe('0 stops')
  })
})

describe('custodySummary', () => {
  const completed = (id: string) => ({ id, state: 'completed' }) as NonNullable<Trip['driver_substitutions']>[number]

  it('names_the_current_driver_and_counts_completed_handovers', () => {
    const driver = base.driver!
    expect(custodySummary(trip({ pending_driver_substitution: null, driver_substitutions: [] }))).toBe(`${driver.full_name} · no handovers`)
    expect(custodySummary(trip({ pending_driver_substitution: null, driver_substitutions: [completed('a')] }))).toBe(`${driver.full_name} · 1 handover`)
    expect(custodySummary(trip({ pending_driver_substitution: null, driver_substitutions: [completed('a'), completed('b')] }))).toBe(`${driver.full_name} · 2 handovers`)
  })

  it('does_not_count_a_cancelled_handover', () => {
    const cancelled = { id: 'c', state: 'cancelled' } as NonNullable<Trip['driver_substitutions']>[number]
    expect(custodySummary(trip({ pending_driver_substitution: null, driver_substitutions: [cancelled] }))).toMatch(/no handovers$/)
  })

  it('says_a_transfer_is_pending', () => {
    const pending = { id: 'p', state: 'pending' } as NonNullable<Trip['pending_driver_substitution']>
    expect(custodySummary(trip({ pending_driver_substitution: pending }))).toBe('Transfer pending')
    expect(hasPendingTransfer(trip({ pending_driver_substitution: pending }))).toBe(true)
    expect(hasPendingTransfer(trip({ pending_driver_substitution: null }))).toBe(false)
    expect(hasPendingTransfer(trip({ pending_driver_substitution: undefined }))).toBe(false)
  })
})

describe('incidentsSummary', () => {
  it('says_none_or_loading_when_there_are_no_incidents', () => {
    expect(incidentsSummary([], false)).toBe('None')
    expect(incidentsSummary([], true)).toBe('Loading…')
  })

  it('says_unavailable_not_none_when_the_load_failed_and_there_is_nothing_to_show', () => {
    expect(incidentsSummary([], false, true)).toBe('Unavailable')
  })

  it('counts_open_and_investigating_incidents', () => {
    expect(incidentsSummary([incident('open')], false)).toBe('1 open')
    expect(incidentsSummary([incident('investigating'), incident('investigating')], false)).toBe('2 investigating')
    expect(incidentsSummary([incident('open'), incident('investigating'), incident('closed')], false)).toBe('1 open · 1 investigating')
  })

  it('does_not_call_a_trip_with_only_closed_incidents_incident_free', () => {
    expect(incidentsSummary([incident('closed'), incident('closed')], false)).toBe('2 closed')
  })

  it('is_active_while_any_incident_is_open_or_investigating', () => {
    expect(hasActiveIncident([incident('open')])).toBe(true)
    expect(hasActiveIncident([incident('closed'), incident('investigating')])).toBe(true)
    expect(hasActiveIncident([incident('closed')])).toBe(false)
    expect(hasActiveIncident([])).toBe(false)
  })
})

describe('leadingActiveIncidentStatus', () => {
  it('is_null_when_every_incident_is_closed_or_there_are_none', () => {
    expect(leadingActiveIncidentStatus([])).toBeNull()
    expect(leadingActiveIncidentStatus([incident('closed')])).toBeNull()
  })

  it('is_investigating_when_that_is_the_most_urgent_left', () => {
    expect(leadingActiveIncidentStatus([incident('closed'), incident('investigating')])).toBe('investigating')
  })

  it('puts_open_ahead_of_investigating', () => {
    expect(leadingActiveIncidentStatus([incident('investigating'), incident('open')])).toBe('open')
  })
})
