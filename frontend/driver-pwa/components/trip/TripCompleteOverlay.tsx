'use client'

import { useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PhaseList } from '@/components/trip/PhaseList'
import { TripContext } from '@/lib/context/TripContext'

const AUTO_DISMISS_MS = 10_000
const TICK_MS = 1_000
const MS_PER_SECOND = 1_000

/**
 * Shown over Home immediately after the last phase of a plan is handed off.
 *
 * WHY AN OVERLAY AND NOT A ROUTE: output: 'export' serves an unknown path as Home
 * (the index.html fallback), so a new route is a liability on iOS — a WebView reload
 * would strand the driver. An overlay rides on whatever route they land on, and the
 * hand-off already pushes Home.
 *
 * WHY OPTIMISTIC: the final phase's evidence is still submitting (and its Hedera anchor
 * still in flight) when this renders. The rows therefore show what the driver just did,
 * with each phase's own anchor state rendered honestly by PhaseList — "Anchoring…" is
 * the truthful label for a receipt that has not landed, and this screen must not imply
 * it has.
 */
export function TripCompleteOverlay() {
  const tripCtx = useContext(TripContext)
  const completed = tripCtx?.completedTrip ?? null
  const dismiss = tripCtx?.dismissTripCompleted
  const [secondsLeft, setSecondsLeft] = useState(AUTO_DISMISS_MS / MS_PER_SECOND)
  const doneRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (completed === null || dismiss === undefined) return
    setSecondsLeft(AUTO_DISMISS_MS / MS_PER_SECOND)
    doneRef.current?.focus()

    const closeAt = Date.now() + AUTO_DISMISS_MS
    const tick = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((closeAt - Date.now()) / MS_PER_SECOND))
      setSecondsLeft(remaining)
      if (remaining === 0) dismiss()
    }, TICK_MS)
    return () => window.clearInterval(tick)
  }, [completed, dismiss])

  if (completed === null || dismiss === undefined) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-complete-heading"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-surface px-5 pb-10 pt-[max(2rem,env(safe-area-inset-top))]"
    >
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 aria-hidden className="size-12 text-success" strokeWidth={2} />
        <h1 id="trip-complete-heading" className="mt-3 text-title-2 text-surface-on">
          Trip complete
        </h1>
        <p className="mt-1 text-subhead text-surface-on-variant">
          {completed.tripReference}
        </p>
      </div>

      <div className="mt-6 flex-1">
        <PhaseList phases={completed.phases} showTimes />
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Button ref={doneRef} variant="primary" size="pill" onClick={dismiss}>
          Done
        </Button>
        <p aria-live="off" className="text-footnote tabular-nums text-surface-on-variant">
          Closing in {secondsLeft}s
        </p>
      </div>
    </div>
  )
}
