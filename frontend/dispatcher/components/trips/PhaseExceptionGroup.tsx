'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { ExceptionSeverity, TripException } from '@shared/lib/types/exception'
import { uniqueExceptionsById } from './exception-dedupe'

interface RevealRequest {
  phaseId: string
  requestId: number
}

interface Props {
  phaseId: string
  /** Names the phase in the group's accessible label, e.g. "Loading". */
  phaseLabel: string
  exceptions: readonly TripException[]
  /** The full exception cards, rendered only while the branch is open. */
  children: ReactNode
  /** Suppresses the trailing rail so the timeline ends on this node, not a dangling line. */
  isLast: boolean
  /** A page-originated request to reveal this group without reaching into its DOM. */
  revealRequest?: RevealRequest | null
  /** Called after a requested disclosure has focused itself, so the owner can scroll. */
  onRevealHandled?: () => void
}

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info']
// Long enough to be seen after the scroll lands, short enough not to read as a status.
const REVEAL_HIGHLIGHT_MS = 1400

function highestSeverity(exceptions: readonly TripException[]): ExceptionSeverity | null {
  return SEVERITY_ORDER.find(severity => exceptions.some(exception => exception.severity === severity)) ?? null
}

/**
 * A phase's exceptions as one branch off the journey rail: a stem leaves the rail and a
 * diamond node carrying the count lands the group in the same chronology as the phase
 * it belongs to, without promoting it to a step of the trip. Collapsed, the row reads
 * the count, how many still need review and the worst severity; opening it reveals the
 * full cards in the order they were recorded. Review state is never touched here.
 */
export function PhaseExceptionGroup({ phaseId, phaseLabel, exceptions, children, isLast, revealRequest, onRevealHandled }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(false)
  const contentId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const handledRequestId = useRef<number | null>(null)
  const uniqueExceptions = uniqueExceptionsById(exceptions)
  const count = uniqueExceptions.length
  const needsReview = uniqueExceptions.filter(exception => exception.review_status === 'needs_review').length
  const severity = highestSeverity(uniqueExceptions)

  useEffect(() => {
    if (revealRequest?.phaseId !== phaseId || revealRequest.requestId === handledRequestId.current) return
    handledRequestId.current = revealRequest.requestId
    let focusFrame: number | null = null
    let timeout: number | null = null
    const frame = window.requestAnimationFrame(() => {
      setOpen(true)
      // A second frame waits for the disclosed cards to enter the DOM before focus and
      // scrolling, without the page imperatively changing this group's local state.
      focusFrame = window.requestAnimationFrame(() => {
        toggleRef.current?.focus({ preventScroll: true })
        setHighlighted(true)
        timeout = window.setTimeout(() => setHighlighted(false), REVEAL_HIGHLIGHT_MS)
        onRevealHandled?.()
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [onRevealHandled, phaseId, revealRequest?.phaseId, revealRequest?.requestId])

  if (count === 0) return null

  const exceptionCopy = count === 1 ? 'exception' : 'exceptions'
  const reviewCopy = needsReview === 1 ? 'needs review' : 'need review'
  return (
    <div role="group" aria-label={`Exceptions linked to ${phaseLabel} phase`} data-timeline-kind="exception" className="relative min-w-0 pb-3">
      {/* A branch off the phase card, not another phase on the journey rail: the stem
          leaves the rail and a smaller diamond node lands the group in the same
          chronology. The rail runs on through the bottom gap unless this is the last row
          of the whole timeline. Drawn outside the button so it is never part of the hit
          area. */}
      <div className="pointer-events-none absolute left-0 top-0 h-full w-[54px]" aria-hidden="true">
        <div className={`absolute left-[14px] top-0 w-0.5 bg-outline-v/30 ${isLast ? 'h-[15px]' : 'bottom-0'}`} />
        <div className="absolute left-[15px] top-[14px] h-px w-[31px] bg-outline-v/50" />
      </div>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
        className="flex w-full min-w-0 items-start gap-[14px] rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
      >
        {/* The diamond repeats the count the text already states, so it is decoration to
            a screen reader, not a second announcement. */}
        <span className="relative block h-[30px] w-[54px] shrink-0" aria-hidden="true">
          <span className="absolute left-[38px] top-[6px] flex h-[17px] w-[17px] rotate-45 items-center justify-center rounded-[3px] border border-warn-c bg-warn-c text-warn-onc ring-[3px] ring-surf-lowest">
            <span className="-rotate-45 font-mono text-[9px] font-[800] leading-none">{count}</span>
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-[5px] text-[13px]">
          <span className="font-[700] text-on-surf">{count} {exceptionCopy}</span>
          <span className={needsReview > 0 ? 'font-[600] text-warn-onc' : 'text-on-surf-v'}>· {needsReview} {reviewCopy}</span>
          {severity && <Chip type={EXCEPTION_SEVERITY_META[severity].chipType} label={EXCEPTION_SEVERITY_META[severity].label} />}
          <Ic n="chev" s={14} aria-hidden className={`ml-auto text-on-surf-v transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        <div id={contentId} className={`ml-[68px] mt-1 space-y-3 rounded-lg transition-shadow motion-reduce:transition-none ${highlighted ? 'ring-2 ring-sec/60' : ''}`}>
          {children}
        </div>
      )}
    </div>
  )
}
