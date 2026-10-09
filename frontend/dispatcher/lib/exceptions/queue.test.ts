import { describe, expect, it } from 'vitest'
import { filterQueue, sortQueueChronologically, sortQueue, groupQueueByTrip } from './queue'
import type { TripExceptionListItem } from '@shared/lib/types/exception'
const row = (id: string, created_at: string, severity: TripExceptionListItem['severity'] = 'warning'): TripExceptionListItem => ({ id: id as TripExceptionListItem['id'], created_at, severity, exception_type: 'gps_mismatch', source: 'system', review_status: 'needs_review', description: 'Literal 20%_finding', trip_id: 'trip', trip_reference: 'FP-full-reference', trip_status: 'closed', origin_name: 'Johannesburg DC', destination_name: 'Durban Depot', driver_name: 'Thabo Mokoena', horse_registration: 'HRS 001 GP', trailer_registrations: ['TRL 101 GP'], phase_label: null, stop_label: null, claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null })
describe('queue chronology and filters', () => {
  it('sorts newest first regardless of severity without mutating input; ties use ID and invalid dates come last', () => {
    const items = [row('older', '2026-10-01T10:00:00Z', 'critical'), row('b', '2026-10-02T10:00:00Z'), row('a', '2026-10-02T10:00:00Z'), row('missing', '')]
    expect(sortQueueChronologically(items).map(x => x.id)).toEqual(['a', 'b', 'older', 'missing'])
    expect(items[0].id).toBe('older')
  })
  it('breaks ties by id in natural order, the same collator every other list uses', () => {
    const items = [row('item-10', '2026-10-02T10:00:00Z'), row('item-9', '2026-10-02T10:00:00Z')]

    expect(sortQueueChronologically(items).map(x => x.id)).toEqual(['item-9', 'item-10'])
  })
  it('uses inclusive South African days and literal substring search while preserving order', () => {
    const items = [row('next', '2026-10-01T22:00:00Z'), row('preceding', '2026-10-01T21:59:00Z'), row('missing', '')]
    expect(filterQueue(items, { q: '%_', fromDate: '2026-10-01', toDate: '2026-10-01' }).map(x => x.id)).toEqual(['preceding'])
    expect(filterQueue(items, { q: 'FP-full' })).toHaveLength(3)
    expect(filterQueue(items, { q: 'not-found' })).toEqual([])
  })
})

describe('optional trip grouping', () => {
  it('keeps trips separate, orders groups and children newest first, dedupes IDs and excludes invalid timestamps from bounds', () => {
    const items = [row('old','2026-10-01T10:00:00Z','critical'), {...row('new','2026-10-02T10:00:00Z'),trip_id:'other'}, row('invalid',''), row('middle','2026-10-01T12:00:00Z'), row('middle','2026-10-01T12:00:00Z')]
    const groups=groupQueueByTrip(items)
    expect(groups.map(g=>g.tripId)).toEqual(['other','trip'])
    expect(groups[1].items.map(x=>x.id)).toEqual(['middle','old','invalid'])
    expect(groups[1].newestRaised).toBe('2026-10-01T12:00:00Z')
    expect(groups[1].oldestRaised).toBe('2026-10-01T10:00:00Z')
    expect(groups[1].severityCounts).toEqual({critical:1,warning:2,info:0})
  })
})

describe('group order ties', () => {
  it('orders groups raised at the same instant by trip id in natural order', () => {
    const items = [{ ...row('x', '2026-10-02T10:00:00Z'), trip_id: 'trip-10' }, { ...row('y', '2026-10-02T10:00:00Z'), trip_id: 'trip-9' }]

    expect(groupQueueByTrip(items).map(g => g.tripId)).toEqual(['trip-9', 'trip-10'])
  })
})

describe('sortQueue', () => {
  const items = [
    { ...row('a', '2026-10-01T10:00:00Z', 'warning'), trip_reference: 'FP-2', driver_name: 'Zola' },
    { ...row('b', '2026-10-02T10:00:00Z', 'critical'), trip_reference: 'FP-1', driver_name: null },
    { ...row('c', '2026-10-03T10:00:00Z', 'info'), trip_reference: 'FP-3', driver_name: 'Amy', claimed_by_user_id: 'u1', claimed_by_name: 'Tim' },
    row('bad', ''),
  ]
  const ids = (key: Parameters<typeof sortQueue>[1]['key'], dir: 'asc' | 'desc') => sortQueue(items, { key, dir }).map(x => x.id)

  it('orders by raised time in both directions with unreadable timestamps always last', () => {
    expect(ids('raised', 'desc')).toEqual(['c', 'b', 'a', 'bad'])
    expect(ids('raised', 'asc')).toEqual(['a', 'b', 'c', 'bad'])
  })
  it('orders incidents most severe first when ascending', () => {
    // Same severity and type ('a' and 'bad') keep their chronological order.
    expect(ids('incident', 'asc')).toEqual(['b', 'a', 'bad', 'c'])
    expect(ids('incident', 'desc')[0]).toBe('c')
  })
  it('orders by trip reference', () => {
    expect(ids('trip', 'asc').slice(0, 3)).toEqual(['b', 'a', 'c'])
  })
  it('puts a missing driver last in both directions', () => {
    expect(ids('crew', 'asc')).toEqual(['c', 'bad', 'a', 'b'])
    expect(ids('crew', 'desc')).toEqual(['a', 'bad', 'c', 'b'])
  })
  it('puts unclaimed before claimed when ascending', () => {
    expect(ids('status', 'asc')).toEqual(['b', 'a', 'bad', 'c'])
    expect(ids('status', 'desc')[0]).toBe('c')
  })
  it('does not mutate its input and breaks ties by chronology', () => {
    const tied = [row('x', '2026-10-01T10:00:00Z'), row('y', '2026-10-02T10:00:00Z')]
    const before = tied.map(t => t.id)
    expect(sortQueue(tied, { key: 'trip', dir: 'asc' }).map(t => t.id)).toEqual(['y', 'x'])
    expect(tied.map(t => t.id)).toEqual(before)
  })
})
