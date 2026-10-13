'use client'

import { useEffect, useRef, useState } from 'react'
import { exceptionRowId } from '@/components/domain/ExceptionRow'

/** A page-originated "Show in timeline". The counter lets the same row be asked for again after
 *  the reader has scrolled away: a repeated id alone would change nothing. */
export interface RevealRequest {
  exceptionId: string
  /** Null for a trip-level exception, which lives in the "Trip record" list. */
  phaseId: string | null
  requestId: number
}

// Long enough to be seen after the scroll lands, short enough not to read as a status.
export const REVEAL_HIGHLIGHT_MS = 2000

interface Pending {
  frames: number[]
  timeout: ReturnType<typeof setTimeout> | null
}

/**
 * Lands a reveal request on its row: once the card has opened and the row is in the DOM, focus
 * it, hand its element id to the page to scroll to, and highlight it for a moment.
 *
 * The cards react to the request through their props (opening, and pinning the row inside the
 * cap), so by the time the second frame runs the row exists. Two frames, because the first lets
 * the commit settle and the second lets layout follow before the page scrolls.
 */
export function useExceptionReveal(
  request: RevealRequest | null | undefined,
  onHandled: ((targetId: string) => void) | undefined,
): { highlightedId: string | null } {
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const handledRequestId = useRef<number | null>(null)
  const pending = useRef<Pending>({ frames: [], timeout: null })
  // The callback is read at landing time, not captured: the page passes a fresh function every
  // render, and re-arming the effect on that would cancel a landing already in flight.
  const handler = useRef(onHandled)
  useEffect(() => { handler.current = onHandled })

  useEffect(() => {
    if (!request || request.requestId === handledRequestId.current) return
    handledRequestId.current = request.requestId
    const targetId = exceptionRowId(request.exceptionId)
    const land = (): void => {
      const row = document.getElementById(targetId)
      if (!row) return
      row.focus({ preventScroll: true })
      setHighlightedId(request.exceptionId)
      if (pending.current.timeout !== null) clearTimeout(pending.current.timeout)
      pending.current.timeout = setTimeout(() => setHighlightedId(null), REVEAL_HIGHLIGHT_MS)
      handler.current?.(targetId)
    }
    pending.current.frames.push(window.requestAnimationFrame(() => {
      pending.current.frames.push(window.requestAnimationFrame(land))
    }))
  }, [request])

  useEffect(() => {
    const current = pending.current
    return () => {
      current.frames.forEach(frame => window.cancelAnimationFrame(frame))
      if (current.timeout !== null) clearTimeout(current.timeout)
      // Forget what was handled, so a development double-mount (which runs this cleanup and then
      // the effect above again) lands the request instead of dropping it.
      handledRequestId.current = null
    }
  }, [])

  return { highlightedId }
}
