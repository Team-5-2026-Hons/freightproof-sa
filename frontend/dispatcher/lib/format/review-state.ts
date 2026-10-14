import type { ExceptionReviewOutcome, TripExceptionListItem } from '@shared/lib/types/exception'

export type ReviewStateKind = 'unreviewed' | 'claimed_by_me' | 'claimed_by_other' | 'reviewed' | 'authored' | 'recorded'
export interface ReviewState { kind: ReviewStateKind; label: string }
export type ReviewStateInput =
  Pick<TripExceptionListItem, 'review_status' | 'claimed_by_user_id' | 'claimed_by_name' | 'reviewed_by_name'>
  & { review_outcome?: ExceptionReviewOutcome | null }

/** One wording for an exception's place in the review workflow, used by the inbox, the
 *  detail page and every timeline card so the three can never disagree. `currentUserId`
 *  is null while the session loads; a claim is then shown as a colleague's, the safe
 *  reading, since it offers take-over rather than review. */
export function reviewState(ex: ReviewStateInput, currentUserId: string | null): ReviewState {
  if (ex.review_status === 'reviewed') {
    const who = ex.reviewed_by_name ?? 'a dispatcher'
    return ex.review_outcome === 'dispatcher_authored'
      ? { kind: 'authored', label: `Dispatcher note by ${who}` }
      : { kind: 'reviewed', label: `Reviewed by ${who}` }
  }
  if (ex.review_status === 'recorded') return { kind: 'recorded', label: 'Recorded' }
  if (ex.claimed_by_user_id === null) return { kind: 'unreviewed', label: 'Unreviewed' }
  if (currentUserId !== null && ex.claimed_by_user_id === currentUserId) {
    return { kind: 'claimed_by_me', label: 'Claimed by you' }
  }
  return { kind: 'claimed_by_other', label: `Claimed by ${ex.claimed_by_name ?? 'a colleague'}` }
}
