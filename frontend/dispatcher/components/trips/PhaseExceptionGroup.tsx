'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { ExceptionSeverity, TripException } from '@shared/lib/types/exception'

interface RevealRequest {
  phaseId: string
  requestId: number
}

interface Props {
  phaseId: string
  exceptions: readonly TripException[]
  children: ReactNode
  onOpenPanel: () => void
  /** A page-originated request to reveal this group without reaching into its DOM. */
  revealRequest?: RevealRequest | null
  /** Called after a requested disclosure has focused itself, so the owner can scroll. */
  onRevealHandled?: () => void
}

const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info']

/** The server normally guarantees unique rows, but a polling merge must not turn one
 * finding into two cards or inflate the count a dispatcher relies on. */
function uniqueById(exceptions: readonly TripException[]): TripException[] {
  const seen = new Set<string>()
  return exceptions.filter(exception => {
    if (seen.has(exception.id)) return false
    seen.add(exception.id)
    return true
  })
}

function highestSeverity(exceptions: readonly TripException[]): ExceptionSeverity | null {
  return SEVERITY_ORDER.find(severity => exceptions.some(exception => exception.severity === severity)) ?? null
}

export function PhaseExceptionGroup({ phaseId, exceptions, children, onOpenPanel, revealRequest, onRevealHandled }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(false)
  const contentId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const handledRequestId = useRef<number | null>(null)
  const uniqueExceptions = uniqueById(exceptions)
  const count = uniqueExceptions.length
  const needsReview = uniqueExceptions.filter(exception => exception.review_status === 'needs_review').length
  const severity = highestSeverity(uniqueExceptions)

  useEffect(() => {
    if (revealRequest?.phaseId !== phaseId || revealRequest.requestId === handledRequestId.current) return
    handledRequestId.current = revealRequest.requestId
    let focusFrame: number | null = null
    const frame = window.requestAnimationFrame(() => {
      setOpen(true)
      // A second frame waits for the disclosed cards to enter the DOM before focus and
      // scrolling, without the page imperatively changing this group's local state.
      focusFrame = window.requestAnimationFrame(() => {
        headingRef.current?.focus({ preventScroll: true })
        setHighlighted(true)
        onRevealHandled?.()
      })
    })
    const timeout = window.setTimeout(() => setHighlighted(false), 1400)
    return () => {
      window.cancelAnimationFrame(frame)
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
      window.clearTimeout(timeout)
    }
  }, [onRevealHandled, phaseId, revealRequest?.phaseId, revealRequest?.requestId])

  if (count === 0) return null

  const exceptionCopy = count === 1 ? 'exception' : 'exceptions'
  const reviewCopy = needsReview === 1 ? 'needs review' : 'need review'
  return (
    <section aria-label="Phase exceptions" className="mt-3 border-t border-outline-v/20 pt-3">
      <div className={`rounded-md ${highlighted ? 'bg-warn-c/50 ring-2 ring-warn/60 motion-reduce:transition-none' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 ref={headingRef} tabIndex={-1} className="text-sm font-bold text-on-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">Exceptions</h4>
          {severity && <Chip type={EXCEPTION_SEVERITY_META[severity].chipType} label={EXCEPTION_SEVERITY_META[severity].label} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen(value => !value)}
            className="rounded-md text-left text-sm font-semibold text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
          >
            {count} {exceptionCopy} · {needsReview} {reviewCopy}
          </button>
          <button type="button" onClick={onOpenPanel} className="text-xs font-semibold text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">View in panel</button>
        </div>
        {open && <div id={contentId} className="mt-3 space-y-3">{children}</div>}
      </div>
    </section>
  )
}
