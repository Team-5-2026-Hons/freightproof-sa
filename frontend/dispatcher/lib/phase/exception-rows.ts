// What a phase card shows of its exceptions: which rows fit under the cap, and the one line
// of review wording on each. Pure (no React) so vitest can prove it.
//
// The timeline only ever shows a handful of rows per phase; the exceptions panel is the
// place a record is read in full (D33). The cap is what keeps a 15-exception trip from
// burying the rail, and the "pinned" row is what keeps "Show in timeline" honest for a row
// the cap would otherwise hide (D42).

import type { ExceptionContactMethod, ExceptionSeverity, TripException } from '@shared/lib/types/exception'
import { countLabel } from '@/lib/format/count'

/** Rows shown per phase before "+n more" (design note O5: three everywhere). */
export const EXCEPTION_ROW_CAP = 3
/** URL phase scope for the Trip record list, distinct from all trip exceptions. */
export const TRIP_LEVEL_SCOPE = 'trip-level'

export function isTripLevelException(exception: TripException, phaseIds: ReadonlySet<string>): boolean {
  return !exception.phase_event_id || !phaseIds.has(exception.phase_event_id)
}

/** "2 exceptions · 1 needs review": how many a phase holds and how many still wait on a reviewer.
 *  Reviewed records still count, so a phase never looks cleaner than it was. */
export function exceptionCountLabel(exceptions: readonly TripException[]): string {
  const needsReview = exceptions.filter(exception => exception.review_status === 'needs_review').length
  const review = needsReview === 0 ? '' : ` · ${needsReview} ${needsReview === 1 ? 'needs' : 'need'} review`
  return `${countLabel(exceptions.length, 'exception')}${review}`
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { critical: 0, warning: 1, info: 2 }
const NEEDS_REVIEW_RANK = 0
const OTHER_RANK = 1

export interface VisibleExceptions {
  visibleIds: ReadonlySet<string>
  hiddenCount: number
}

/** Lower sorts first: unreviewed, then the worse severity, then the newest, then id so the
 *  choice never depends on the order the inputs arrived in. */
function compareByUrgency(a: TripException, b: TripException): number {
  const review = (e: TripException): number => e.review_status === 'needs_review' ? NEEDS_REVIEW_RANK : OTHER_RANK
  return review(a) - review(b)
    || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || Date.parse(b.created_at) - Date.parse(a.created_at)
    || a.id.localeCompare(b.id)
}

/** The rows to show out of `exceptions`. A `pinnedId` that the cap would hide takes the place
 *  of the least urgent visible row, so a deep link or "Show in timeline" always finds its row. */
export function visibleExceptions(
  exceptions: readonly TripException[],
  pinnedId: string | null,
  cap: number = EXCEPTION_ROW_CAP,
): VisibleExceptions {
  const ranked = [...exceptions].sort(compareByUrgency)
  const kept = ranked.slice(0, cap).map(exception => exception.id as string)
  const pinned = pinnedId !== null && exceptions.some(exception => exception.id === pinnedId)
  if (pinned && !kept.includes(pinnedId) && kept.length > 0) kept[kept.length - 1] = pinnedId
  return { visibleIds: new Set(kept), hiddenCount: Math.max(exceptions.length - cap, 0) }
}

const CONTACT_WORDING: Record<ExceptionContactMethod, string> = {
  phone: 'by phone',
  whatsapp: 'by WhatsApp',
  in_person: 'in person',
}

const DISPATCHER_NOTE_OUTCOME = 'dispatcher_authored'

/** One line of review state for a row: "Needs review", "Recorded", or "Reviewed · {outcome}
 *  · {contact}". The queue's claim wording stays in the panel, where the claim can be acted on. */
export function exceptionReviewLabel(exception: TripException): string {
  if (exception.review_status === 'needs_review') return 'Needs review'
  if (exception.review_status === 'recorded') return 'Recorded'
  // A dispatcher's own note is authored, not reviewed: its outcome is an internal marker.
  if (exception.review_outcome === DISPATCHER_NOTE_OUTCOME) return 'Dispatcher note'
  return [
    'Reviewed',
    exception.review_outcome?.replaceAll('_', ' '),
    exception.contact_method ? CONTACT_WORDING[exception.contact_method] : undefined,
  ].filter((part): part is string => Boolean(part)).join(' · ')
}
