'use client'

import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { exceptionDescriptionText, fmtExceptionType } from '@/lib/format/exception'
import { DEVICE_CLOCK, SERVER_CLOCK } from '@/lib/phase/act-wording'
import { exceptionReviewLabel } from '@/lib/phase/exception-rows'
import { NumericText } from './NumericText'
import { COMPACT_HIT_AREA, COMPACT_SUBGRID, CompactActLine } from './CompactActLine'
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
const ROW_CARD = 'border border-outline-v/40 hover:border-outline'
const ROW_CARD_CRITICAL = 'border border-err/60 hover:border-err'
// Selection persists; a landing highlight fades. Neither replaces keyboard focus or severity.
// Selection is a 1 px hairline inside the row; keyboard focus alone is the 2 px outline outside it,
// so a reader tabbing past the selected row never sees two rows that look focused (A3).
export const EXCEPTION_SELECTION_OUTLINE = 'shadow-[inset_0_0_0_1px_theme(colors.sec.DEFAULT)]'
export const EXCEPTION_SELECTED_SURFACE = 'bg-sec-c/25'
const ROW_HIGHLIGHT = 'bg-sec-c/70'
const ROW_TRANSITION = 'transition-colors duration-700 hover:duration-150 motion-reduce:transition-none'

const OPEN_ACTION = 'Open in exceptions panel'
// The accessible name carries the first words of the visible description (label in name), but
// not all of it: the panel is where it is read in full.
const NAME_EXCERPT_WORDS = 8

function descriptionExcerpt(description: string): string {
  const words = description.trim().split(/\s+/)
  return words.length > NAME_EXCERPT_WORDS ? `${words.slice(0, NAME_EXCERPT_WORDS).join(' ')}…` : words.join(' ')
}

const ROW_BASE = 'relative block min-h-11 w-full min-w-0 rounded-md px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'

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
  density?: 'compact' | 'full'
  /** Compact only: the rail continues from this row's icon to the next row. */
  connectToNext?: boolean
}

function cardClass(exception: TripException, selected: boolean, highlighted: boolean): string {
  const card = exception.severity === 'critical' ? ROW_CARD_CRITICAL : ROW_CARD
  const surface = highlighted ? ROW_HIGHLIGHT : selected ? EXCEPTION_SELECTED_SURFACE : 'bg-surf-lowest'
  return `${ROW_BASE} ${card} ${surface} ${ROW_TRANSITION} ${selected || highlighted ? EXCEPTION_SELECTION_OUTLINE : ''}`
}

/**
 * One exception on the timeline: type, severity, time, source, review state and two lines of
 * the description. The whole row is a button that opens that record in the exceptions panel
 * (D33): the panel is where an exception is read and handled, so the timeline never renders
 * the full card. The time names its clock (D16): the phone's when the instant is the evidence
 * capture, the server's when it is the time the system recorded the exception.
 */
export function ExceptionRow({ exception, at, phaseId, selected, highlighted, onOpen, density = 'full', connectToNext = false }: RowProps) {
  const severity = EXCEPTION_SEVERITY_META[exception.severity]
  const typeLabel = fmtExceptionType(exception.exception_type)
  const review = exceptionReviewLabel(exception)
  const clock = at === exception.created_at ? SERVER_CLOCK : DEVICE_CLOCK
  if (density === 'compact') return (
    <button type="button" id={exceptionRowId(exception.id)} aria-current={selected ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined} onClick={() => onOpen(exception.id, phaseId)}
      className={`${COMPACT_SUBGRID} ${COMPACT_HIT_AREA} relative w-full rounded text-left text-on-surf hover:bg-sec-c/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec ${ROW_TRANSITION} ${highlighted ? ROW_HIGHLIGHT : selected ? EXCEPTION_SELECTED_SURFACE : ''} ${selected || highlighted ? EXCEPTION_SELECTION_OUTLINE : ''}`}>
      <CompactActLine times={[{ at, source: at === exception.created_at ? 'server' : 'device' }]} icon="warn" iconClassName="text-warn" connectToNext={connectToNext}>
        <span className="font-semibold">{typeLabel}</span> · {severity.label} · {review}
      </CompactActLine>
    </button>
  )
  return (
    <button
      type="button"
      id={exceptionRowId(exception.id)}
      // Opening a panel is navigation, not a toggle, so the selected row is `current`, not `pressed`.
      aria-current={selected ? 'true' : undefined}
      aria-label={`${typeLabel}, ${severity.label}, ${review}. ${OPEN_ACTION}. ${descriptionExcerpt(exceptionDescriptionText(exception))}`}
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
      <span className="mt-0.5 line-clamp-2 text-body text-on-surf">{exceptionDescriptionText(exception)}</span>
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
  density?: 'compact' | 'full'
}

/** The "+n more" row a card shows once its exceptions pass the cap: the rest are one click
 *  away in the panel, filtered to this phase. */
export function ExceptionMoreRow({ hiddenCount, phaseId, onOpen, density = 'full' }: MoreProps) {
  if (density === 'compact') return <button type="button" onClick={() => onOpen(null, phaseId)}
    aria-label={`+${hiddenCount} more · ${OPEN_ACTION}`} className={`${COMPACT_SUBGRID} ${COMPACT_HIT_AREA} relative w-full rounded text-left text-sec hover:bg-sec-c/40 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec`}>
    <CompactActLine times={[]} icon="plus" iconClassName="text-sec"><NumericText text={`+${hiddenCount} more`} /> · {OPEN_ACTION}</CompactActLine>
  </button>
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
