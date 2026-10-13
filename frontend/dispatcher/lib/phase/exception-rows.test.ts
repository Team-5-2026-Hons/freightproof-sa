import { describe, expect, it } from 'vitest'
import type { TripException } from '@shared/lib/types/exception'
import { EXCEPTION_ROW_CAP, exceptionReviewLabel, visibleExceptions } from './exception-rows'

function exception(id: string, overrides: Partial<TripException> = {}): TripException {
  return {
    id: id as TripException['id'], trip_id: 'trip-1', exception_type: 'route_deviation', source: 'system',
    severity: 'warning', description: `Recorded ${id}`, phase_event_id: 'phase-1', checkpoint_id: null,
    supporting_artifact_id: null, review_status: 'recorded', review_outcome: null, reviewed_by_user_id: null,
    reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null, merkle_batch_id: null,
    claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
    created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z', ...overrides,
  }
}

describe('visibleExceptions', () => {
  it('shows every row when there are no more than the cap', () => {
    const rows = [exception('a'), exception('b'), exception('c')]

    const result = visibleExceptions(rows, null)

    expect([...result.visibleIds]).toEqual(['a', 'b', 'c'])
    expect(result.hiddenCount).toBe(0)
  })

  it('keeps the rows that most need attention: unreviewed first, then critical, then newest', () => {
    const rows = [
      exception('old-info', { severity: 'info', created_at: '2026-01-01T08:00:00Z' }),
      exception('reviewed-critical', { severity: 'critical', review_status: 'reviewed', created_at: '2026-01-01T09:00:00Z' }),
      exception('needs-review-warning', { review_status: 'needs_review', created_at: '2026-01-01T10:00:00Z' }),
      exception('recorded-warning-new', { created_at: '2026-01-01T12:00:00Z' }),
      exception('needs-review-critical', { review_status: 'needs_review', severity: 'critical', created_at: '2026-01-01T07:00:00Z' }),
      exception('recorded-warning-newer', { created_at: '2026-01-01T13:00:00Z' }),
    ]

    const result = visibleExceptions(rows, null)

    expect(EXCEPTION_ROW_CAP).toBe(3)
    expect(new Set(result.visibleIds)).toEqual(new Set(['needs-review-critical', 'needs-review-warning', 'reviewed-critical']))
    expect(result.hiddenCount).toBe(3)
  })

  it('swaps a pinned hidden row in for the lowest-priority visible one', () => {
    const rows = [
      exception('a', { review_status: 'needs_review', severity: 'critical' }),
      exception('b', { review_status: 'needs_review' }),
      exception('c', { review_status: 'needs_review', severity: 'info' }),
      exception('d', { severity: 'info' }),
    ]

    const result = visibleExceptions(rows, 'd')

    expect(new Set(result.visibleIds)).toEqual(new Set(['a', 'b', 'd']))
    expect(result.hiddenCount).toBe(1)
  })

  it('leaves the set alone when the pinned row is already visible or is not on the list', () => {
    const rows = [exception('a'), exception('b'), exception('c'), exception('d', { severity: 'info' })]

    expect(new Set(visibleExceptions(rows, 'a').visibleIds)).toEqual(new Set(['a', 'b', 'c']))
    expect(new Set(visibleExceptions(rows, 'nope').visibleIds)).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('exceptionReviewLabel', () => {
  it('says Needs review for a record nobody has reviewed', () => {
    expect(exceptionReviewLabel(exception('a', { review_status: 'needs_review' }))).toBe('Needs review')
  })

  it('says Recorded for a record that never needed review', () => {
    expect(exceptionReviewLabel(exception('a'))).toBe('Recorded')
  })

  it('names the outcome and the contact method of a reviewed record', () => {
    const reviewed = exception('a', { review_status: 'reviewed', review_outcome: 'no_action_required', contact_method: 'phone' })

    expect(exceptionReviewLabel(reviewed)).toBe('Reviewed · no action required · by phone')
  })

  it('leaves out a contact method nobody recorded, and calls a dispatcher\'s own note a note', () => {
    expect(exceptionReviewLabel(exception('a', { review_status: 'reviewed', review_outcome: 'evidence_verified' })))
      .toBe('Reviewed · evidence verified')
    expect(exceptionReviewLabel(exception('b', { review_status: 'reviewed', review_outcome: 'dispatcher_authored' })))
      .toBe('Dispatcher note')
  })
})
