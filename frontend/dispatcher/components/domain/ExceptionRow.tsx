'use client'

import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { fmtExceptionType } from '@/lib/format/exception'
import { DEVICE_CLOCK, SERVER_CLOCK } from '@/lib/phase/act-wording'
import { exceptionReviewLabel } from '@/lib/phase/exception-rows'
import { NumericText } from './NumericText'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { TripException } from '@shared/lib/types/exception'

/** What every exception row calls: a record id selects it in the panel; a null id opens the
 *  phase's records ("+n more"); a null phase is a trip-level exception (D42). */
export type OpenException = (exceptionId: string | null, phaseId: string | null) => void

/** An exception and the instant the rail orders it by (`exceptionEventTime`). */
export interface ExceptionRowData {
  exception: TripException
  at: string
}

const ROW_ID_PREFIX = 'exception-row-'

/** The DOM id "Show in timeline" scrolls to. One per exception: a row renders once, under the
 *  header while its card is collapsed or in the rail while open, never both. */
export function exceptionRowId(exceptionId: string): string {
  return `${ROW_ID_PREFIX}${exceptionId}`
}

// Open item O1: the card treatment around a row is deliberately one class string, so the owner's
// choice (this, no card, or a severity tint) is a one-line change.
const ROW_CARD = 'border border-outline-v/40 bg-surf-lowest hover:border-outline'
const ROW_CARD_CRITICAL = 'border border-err/60 bg-surf-lowest hover:border-err'
const ROW_CARD_SELECTED = 'border border-sec bg-sec-c/60'
const ROW_HIGHLIGHT = 'ring-2 ring-sec/60'

const OPEN_ACTION = 'Open in exceptions panel'
// The accessible name carries the first words of the visible description (label in name), but
// not all of it: the panel is where it is read in full.
const NAME_EXCERPT_WORDS = 8

function descriptionExcerpt(description: string): string {
  const words = description.trim().split(/\s+/)
  return words.length > NAME_EXCERPT_WORDS ? `${words.slice(0, NAME_EXCERPT_WORDS).join(' ')}…` : words.join(' ')
}

const ROW_BASE = 'block min-h-11 w-full min-w-0 rounded-md px-3 py-2 text-left transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'

interface RowProps {
  exception: TripException
  /** The instant the rail orders the row by: the supporting evidence's capture time when it
   *  has one, otherwise the time the system recorded it. */
  at: string
  phaseId: string | null
  /** The exceptions panel is open on this record. */
  selected: boolean
  /** "Show in timeline" just landed here. */
  highlighted: boolean
  onOpen: OpenException
}

function cardClass(exception: TripException, selected: boolean, highlighted: boolean): string {
  const card = selected ? ROW_CARD_SELECTED : exception.severity === 'critical' ? ROW_CARD_CRITICAL : ROW_CARD
  return `${ROW_BASE} ${card} ${highlighted ? ROW_HIGHLIGHT : ''}`
}

/**
 * One exception on the timeline: type, severity, time, source, review state and two lines of
 * the description. The whole row is a button that opens that record in the exceptions panel
 * (D33): the panel is where an exception is read and handled, so the timeline never renders
 * the full card. The time names its clock (D16): the phone's when the instant is the evidence
 * capture, the server's when it is the time the system recorded the exception.
 */
export function ExceptionRow({ exception, at, phaseId, selected, highlighted, onOpen }: RowProps) {
  const severity = EXCEPTION_SEVERITY_META[exception.severity]
  const typeLabel = fmtExceptionType(exception.exception_type)
  const review = exceptionReviewLabel(exception)
  const clock = at === exception.created_at ? SERVER_CLOCK : DEVICE_CLOCK
  return (
    <button
      type="button"
      id={exceptionRowId(exception.id)}
      // Opening a panel is navigation, not a toggle, so the selected row is `current`, not `pressed`.
      aria-current={selected ? 'true' : undefined}
      aria-label={`${typeLabel}, ${severity.label}, ${review}. ${OPEN_ACTION}. ${descriptionExcerpt(exception.description)}`}
      data-highlighted={highlighted ? 'true' : undefined}
      onClick={() => onOpen(exception.id, phaseId)}
      className={cardClass(exception, selected, highlighted)}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-body font-semibold text-on-surf">
        {typeLabel}
        <Chip type={severity.chipType} label={severity.label} />
      </span>
      <span className="block text-meta text-on-surf-v">
        <span className="font-semibold tabular-nums tracking-[0.03em]">{fmtDateTime(at)} {clock}</span>
        {' · '}Raised by {EXCEPTION_SOURCE_META[exception.source].label.toLowerCase()}
        {' · '}<span className={exception.review_status === 'needs_review' ? 'font-semibold text-warn-onc' : ''}>{review}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 block text-body text-on-surf">{exception.description}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-meta font-semibold text-sec">
        {OPEN_ACTION} <Ic n="chev" s={11} />
      </span>
    </button>
  )
}

interface MoreProps {
  hiddenCount: number
  phaseId: string | null
  onOpen: OpenException
}

/** The "+n more" row a card shows once its exceptions pass the cap: the rest are one click
 *  away in the panel, filtered to this phase. */
export function ExceptionMoreRow({ hiddenCount, phaseId, onOpen }: MoreProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(null, phaseId)}
      aria-label={`+${hiddenCount} more · ${OPEN_ACTION}`}
      className="block min-h-11 w-full rounded-md border border-dashed border-outline-v/60 px-3 py-2 text-left text-body font-semibold text-sec hover:border-outline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
    >
      <NumericText text={`+${hiddenCount} more`} /> · {OPEN_ACTION}
    </button>
  )
}
