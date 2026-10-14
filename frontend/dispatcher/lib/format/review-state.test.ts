import { describe, expect, it } from 'vitest'
import { reviewState } from './review-state'

const base = { review_status: 'needs_review' as const, claimed_by_user_id: null, claimed_by_name: null, reviewed_by_name: null }

describe('reviewState', () => {
  it('is Unreviewed when nobody holds it', () => {
    expect(reviewState(base, 'me')).toEqual({ kind: 'unreviewed', label: 'Unreviewed' })
  })
  it('is Claimed by you for my own claim', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'me', claimed_by_name: 'Me' }, 'me'))
      .toEqual({ kind: 'claimed_by_me', label: 'Claimed by you' })
  })
  it("names a colleague's claim", () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'ana', claimed_by_name: 'Ana' }, 'me'))
      .toEqual({ kind: 'claimed_by_other', label: 'Claimed by Ana' })
  })
  it('falls back when the claimer name is unavailable', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'ana' }, 'me').label).toBe('Claimed by a colleague')
  })
  it('treats every claim as a colleague while the session is still loading', () => {
    expect(reviewState({ ...base, claimed_by_user_id: 'me', claimed_by_name: 'Me' }, null).kind).toBe('claimed_by_other')
  })
  it('names the reviewer', () => {
    expect(reviewState({ ...base, review_status: 'reviewed', reviewed_by_name: 'Ben' }, 'me'))
      .toEqual({ kind: 'reviewed', label: 'Reviewed by Ben' })
  })
  it("marks a dispatcher's own note as written, not reviewed", () => {
    expect(reviewState({ ...base, review_status: 'reviewed', review_outcome: 'dispatcher_authored', reviewed_by_name: 'Ben' }, 'me'))
      .toEqual({ kind: 'authored', label: 'Dispatcher note by Ben' })
  })
  it('keeps legacy recorded rows readable', () => {
    expect(reviewState({ ...base, review_status: 'recorded' }, 'me')).toEqual({ kind: 'recorded', label: 'Recorded' })
  })
})
