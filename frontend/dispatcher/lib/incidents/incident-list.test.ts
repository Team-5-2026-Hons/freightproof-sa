import { describe, expect, it } from 'vitest'
import type { IncidentSummary } from '@/lib/types/incident'
import {
  DEFAULT_INCIDENT_SORT, defaultIncidentSortDirection, filterIncidents, matchesIncidentSearch, paginate, sortIncidents,
} from './incident-list'

let counter = 0
function incident(overrides: Partial<IncidentSummary> = {}): IncidentSummary {
  counter += 1
  return {
    incident_id: `incident-${counter}`, reference: `INC${counter}`, trip_id: `trip-${counter}`, trip_reference: `FP-2026-000${counter}`,
    trip_status: 'active', incident_type: 'hijacking', summary: 'Truck stopped at the roadside.', status: 'open',
    confidence: 'reported', outcome: null, assigned_to_user_id: null, assigned_to_name: null,
    reported_occurred_at: null, received_at: '2026-10-20T10:00:00Z', trip_stopped_at: null, closed_at: null,
    created_at: '2026-10-20T10:00:00Z', exception_ids: [], exceptions_total: 0, exceptions_reviewed: 0,
    parcels_total: 0, parcels_unresolved: 0,
    ...overrides,
  } as IncidentSummary
}

const ids = (rows: readonly IncidentSummary[]) => rows.map(r => r.incident_id)

describe('matchesIncidentSearch', () => {
  const row = incident({ trip_reference: 'FP-20261020-E30768BA', reference: 'INC7', summary: 'Armed men boarded', assigned_to_name: 'Demo Dispatcher' })

  it.each([
    ['trip reference', 'e30768ba'],
    ['incident reference', 'inc7'],
    ['summary', 'ARMED MEN'],
    ['investigator', 'demo disp'],
  ])('matches_on_%s_case_insensitively', (_field, query) => {
    expect(matchesIncidentSearch(row, query)).toBe(true)
  })

  it('does_not_match_unrelated_text', () => {
    expect(matchesIncidentSearch(row, 'durban')).toBe(false)
  })

  it('matches_everything_for_an_empty_or_blank_query', () => {
    expect(matchesIncidentSearch(row, '')).toBe(true)
    expect(matchesIncidentSearch(row, '   ')).toBe(true)
  })

  it('copes_with_an_unassigned_incident', () => {
    expect(matchesIncidentSearch(incident({ assigned_to_name: null }), 'nobody')).toBe(false)
  })
})

describe('filterIncidents owner view', () => {
  const mine = incident({ assigned_to_user_id: 'me', assigned_to_name: 'Me' })
  const other = incident({ assigned_to_user_id: 'them', assigned_to_name: 'Them' })
  const nobody = incident()

  it('unassigned_keeps_only_incidents_with_no_investigator', () => {
    expect(ids(filterIncidents([mine, other, nobody], { search: '', owner: 'unassigned' }))).toEqual([nobody.incident_id])
  })

  it.each(['anyone', 'mine'] as const)('%s_leaves_the_owner_to_the_server', owner => {
    expect(filterIncidents([mine, other, nobody], { search: '', owner })).toHaveLength(3)
  })

  it('combines_search_with_the_owner_view', () => {
    const a = incident({ summary: 'fuel theft' })
    const b = incident({ summary: 'hijack', assigned_to_user_id: 'x' })
    expect(ids(filterIncidents([a, b], { search: 'fuel', owner: 'unassigned' }))).toEqual([a.incident_id])
    expect(filterIncidents([a, b], { search: 'hijack', owner: 'unassigned' })).toEqual([])
  })
})

describe('sortIncidents', () => {
  it('defaults_to_newest_received_first', () => {
    const older = incident({ received_at: '2026-10-01T00:00:00Z' })
    const newer = incident({ received_at: '2026-10-05T00:00:00Z' })
    expect(ids(sortIncidents([older, newer], DEFAULT_INCIDENT_SORT))).toEqual([newer.incident_id, older.incident_id])
  })

  it('sorts_reference_by_trip_then_incident', () => {
    const b2 = incident({ trip_reference: 'FP-B', reference: 'INC2' })
    const b1 = incident({ trip_reference: 'FP-B', reference: 'INC1' })
    const a = incident({ trip_reference: 'FP-A', reference: 'INC9' })
    expect(ids(sortIncidents([b2, a, b1], { key: 'reference', dir: 'asc' }))).toEqual([a.incident_id, b1.incident_id, b2.incident_id])
  })

  it('sorts_status_open_then_investigating_then_closed', () => {
    const closed = incident({ status: 'closed' })
    const open = incident({ status: 'open' })
    const investigating = incident({ status: 'investigating' })
    expect(ids(sortIncidents([closed, investigating, open], { key: 'status', dir: 'asc' })))
      .toEqual([open.incident_id, investigating.incident_id, closed.incident_id])
  })

  it('sorts_type_by_name', () => {
    const shortage = incident({ incident_type: 'parcel_shortage' })
    const hijack = incident({ incident_type: 'hijacking' })
    expect(ids(sortIncidents([shortage, hijack], { key: 'type', dir: 'asc' }))).toEqual([hijack.incident_id, shortage.incident_id])
  })

  it('puts_incidents_with_no_parcels_last_in_either_direction', () => {
    const none = incident({ parcels_total: 0 })
    const few = incident({ parcels_total: 5, parcels_unresolved: 1 })
    const many = incident({ parcels_total: 5, parcels_unresolved: 4 })
    expect(ids(sortIncidents([none, few, many], { key: 'cargo', dir: 'asc' }))).toEqual([few.incident_id, many.incident_id, none.incident_id])
    expect(ids(sortIncidents([none, few, many], { key: 'cargo', dir: 'desc' }))).toEqual([many.incident_id, few.incident_id, none.incident_id])
  })

  it('puts_unassigned_last_when_sorting_by_investigator', () => {
    const nobody = incident()
    const ann = incident({ assigned_to_name: 'Ann' })
    const zed = incident({ assigned_to_name: 'Zed' })
    expect(ids(sortIncidents([zed, nobody, ann], { key: 'owner', dir: 'asc' }))).toEqual([ann.incident_id, zed.incident_id, nobody.incident_id])
    expect(ids(sortIncidents([zed, nobody, ann], { key: 'owner', dir: 'desc' }))).toEqual([zed.incident_id, ann.incident_id, nobody.incident_id])
  })

  it('keeps_equal_rows_in_a_stable_order', () => {
    const a = incident({ status: 'open', received_at: '2026-10-01T00:00:00Z' })
    const b = incident({ status: 'open', received_at: '2026-10-02T00:00:00Z' })
    expect(ids(sortIncidents([a, b], { key: 'status', dir: 'asc' }))).toEqual([b.incident_id, a.incident_id])
  })

  it('opens_time_and_cargo_columns_descending_and_the_rest_ascending', () => {
    expect(defaultIncidentSortDirection('received')).toBe('desc')
    expect(defaultIncidentSortDirection('cargo')).toBe('desc')
    expect(defaultIncidentSortDirection('reference')).toBe('asc')
    expect(defaultIncidentSortDirection('status')).toBe('asc')
  })
})

describe('paginate', () => {
  const rows = Array.from({ length: 5 }, (_, i) => i)

  it('slices_the_requested_page', () => {
    expect(paginate(rows, 2, 2)).toMatchObject({ rows: [2, 3], page: 2, totalItems: 5, hasPrevious: true, hasNext: true })
  })

  it('marks_the_first_and_last_pages', () => {
    expect(paginate(rows, 1, 2)).toMatchObject({ rows: [0, 1], hasPrevious: false, hasNext: true })
    expect(paginate(rows, 3, 2)).toMatchObject({ rows: [4], hasPrevious: true, hasNext: false })
  })

  it('has_no_next_page_when_the_total_is_an_exact_multiple', () => {
    expect(paginate(rows.slice(0, 4), 2, 2)).toMatchObject({ rows: [2, 3], hasNext: false })
  })

  it('clamps_a_page_past_the_end_to_the_last_page', () => {
    expect(paginate(rows, 9, 2)).toMatchObject({ rows: [4], page: 3 })
  })

  it('clamps_a_page_below_one_to_the_first_page', () => {
    expect(paginate(rows, 0, 2)).toMatchObject({ rows: [0, 1], page: 1 })
  })

  it('returns_an_empty_first_page_for_an_empty_list', () => {
    expect(paginate([], 1, 25)).toMatchObject({ rows: [], page: 1, totalItems: 0, hasPrevious: false, hasNext: false })
  })
})
