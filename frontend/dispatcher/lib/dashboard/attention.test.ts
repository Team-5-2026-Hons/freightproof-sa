import { describe, expect, it } from 'vitest'

import { exceptionsNeedingAttention, openIncidents, activeTripsByAttention } from './attention'
import type { IncidentSummary } from '@/lib/types/incident'
import type { TripExceptionListItem } from '@shared/lib/types/exception'
import type { TripSummary } from '@shared/lib/types/trip'

const exception = (id: string, overrides: Partial<TripExceptionListItem> = {}): TripExceptionListItem =>
  ({ id, severity: 'warning', review_status: 'needs_review', created_at: '2026-10-20T08:00:00Z', ...overrides }) as unknown as TripExceptionListItem

const incident = (id: string, overrides: Partial<IncidentSummary> = {}): IncidentSummary =>
  ({ incident_id: id, status: 'open', received_at: '2026-10-20T08:00:00Z', ...overrides }) as unknown as IncidentSummary

describe('exceptionsNeedingAttention', () => {
  it('puts an older critical ahead of newer infos', () => {
    const items = [
      exception('info-new', { severity: 'info', created_at: '2026-10-21T09:00:00Z' }),
      exception('critical-old', { severity: 'critical', created_at: '2026-10-19T09:00:00Z' }),
      exception('warning-mid', { severity: 'warning', created_at: '2026-10-20T09:00:00Z' }),
    ]

    const ids = exceptionsNeedingAttention(items).map(i => i.id)

    expect(ids).toEqual(['critical-old', 'warning-mid', 'info-new'])
  })

  it('orders equal severities newest first, with ids breaking ties', () => {
    const items = [
      exception('b', { created_at: '2026-10-20T08:00:00Z' }),
      exception('a', { created_at: '2026-10-20T08:00:00Z' }),
      exception('newest', { created_at: '2026-10-21T08:00:00Z' }),
    ]

    const ids = exceptionsNeedingAttention(items).map(i => i.id)

    expect(ids).toEqual(['newest', 'a', 'b'])
  })

  it('drops anything already reviewed or recorded', () => {
    const items = [
      exception('open'),
      exception('reviewed', { review_status: 'reviewed' }),
      exception('recorded', { review_status: 'recorded' }),
    ]

    const ids = exceptionsNeedingAttention(items).map(i => i.id)

    expect(ids).toEqual(['open'])
  })

  it('sorts an unreadable timestamp last within its severity and leaves the input untouched', () => {
    const items = [exception('bad', { created_at: 'garbage' }), exception('good')]

    const ids = exceptionsNeedingAttention(items).map(i => i.id)

    expect(ids).toEqual(['good', 'bad'])
    expect(items.map(i => i.id)).toEqual(['bad', 'good'])
  })
})

describe('openIncidents', () => {
  it('excludes closed incidents and lists the newest report first', () => {
    const incidents = [
      incident('old', { received_at: '2026-10-18T08:00:00Z' }),
      incident('closed', { status: 'closed', received_at: '2026-10-21T08:00:00Z' }),
      incident('investigating', { status: 'investigating', received_at: '2026-10-20T08:00:00Z' }),
    ]

    const ids = openIncidents(incidents).map(i => i.incident_id)

    expect(ids).toEqual(['investigating', 'old'])
  })
})

const trip = (id: string, overrides: Partial<TripSummary> = {}): TripSummary =>
  ({ id, trip_reference: id, status: 'active', needs_review_count: 1, created_at: '2026-10-20T08:00:00Z', phase_total: 7, phase_completed: 2, ...overrides }) as unknown as TripSummary

describe('activeTripsByAttention', () => {
  it('keeps every active trip, flagged or not, and drops closed and cancelled ones', () => {
    const trips = [
      trip('flagged'),
      trip('held', { status: 'exception_hold' }),
      trip('quiet', { needs_review_count: 0 }),
      trip('closed', { status: 'closed' }),
      trip('cancelled', { status: 'cancelled' }),
    ]

    const ids = activeTripsByAttention(trips, []).map(t => t.id).sort()

    expect(ids).toEqual(['flagged', 'held', 'quiet'])
  })

  it('puts flagged trips first, a critical ahead of more warnings, and quiet trips last', () => {
    const trips = [
      trip('quiet', { needs_review_count: 0 }),
      trip('warnings', { needs_review_count: 5, attention: { critical: 0, warning: 5, info: 0, claimed: 0 } }),
      trip('critical', { needs_review_count: 1, attention: { critical: 1, warning: 0, info: 0, claimed: 0 } }),
    ]

    const ids = activeTripsByAttention(trips, []).map(t => t.id)

    expect(ids).toEqual(['critical', 'warnings', 'quiet'])
  })

  it('does not cap the result, so the panel can state the true total', () => {
    const trips = Array.from({ length: 12 }, (_, i) => trip(`t${i}`))

    expect(activeTripsByAttention(trips, [])).toHaveLength(12)
  })
})
