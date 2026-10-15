// frontend/driver-pwa/app/(app)/trip/panic/PanicPageClient.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, MapPin, Route, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocation } from '@/lib/hooks/useLocation'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { CallDispatch } from '@/components/trip/CallDispatch'
import { Button } from '@/components/ui/Button'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { ROUTES } from '@/lib/constants/routes'
import { captureWithinBudget, REPORT_CAPTURE_BUDGET_MS } from '@/lib/utils/bounded-capture'
import { markTransition } from '@/lib/navigation/transition-direction'
import { cn } from '@/lib/utils'

type LocationStatus = 'finding' | 'found' | 'unavailable'

const LOCATION_LABEL: Record<LocationStatus, string> = {
  finding: 'Finding…',
  found: 'Found',
  unavailable: 'Not available',
}

export default function PanicPageClient() {
  const router = useRouter()
  const { trip, isLoading, logException } = useTrip()
  const { capture } = useLocation()
  const { enqueueException } = useOfflineQueue()
  const [sending, setSending] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  // A finger is on the swipe: the red pulse runs and the copy says how to back out (7.1b).
  const [pressed, setPressed] = useState(false)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('finding')
  const hasTrip = trip !== null

  // One reading as the screen opens, to say honestly whether the phone can place the
  // driver — and to warm the GPS so the send's own bounded capture is quick. Display
  // only: the alert still takes, and sends, its own fix, exactly as before.
  useEffect(() => {
    if (!hasTrip) return
    let live = true
    capture()
      .then((fix) => { if (live) setLocationStatus(fix === null ? 'unavailable' : 'found') })
      .catch((err: unknown) => {
        console.warn('Panic screen: location warm-up failed', err)
        if (live) setLocationStatus('unavailable')
      })
    return () => { live = false }
  }, [hasTrip, capture])

  function cancel() {
    markTransition('back')
    // Explicit replace, not router.back(): this page is reachable by cold load or deep
    // link, where there may be no history to pop.
    router.replace(ROUTES.inTransit)
  }

  async function handlePanic() {
    setSending(true)
    setSaveFailed(false)
    // The alert must carry the driver's own position when the phone can give one —
    // it is the primary evidence of where the driver was when they pressed panic — but
    // emergency delivery is never held behind a slow GPS. captureWithinBudget races the
    // fix against REPORT_CAPTURE_BUDGET_MS: a fix inside that window travels with the
    // alert (live send and offline queue alike), a slower one is dropped and the alert
    // goes without location rather than waiting. No preview and no acknowledgement
    // flow here, ever (P6): panic is sent, not checked.
    const fix = await captureWithinBudget(capture, REPORT_CAPTURE_BUDGET_MS)
    const triggeredAt = new Date().toISOString()
    const description = 'Driver activated panic button.'
    const clientReportId = crypto.randomUUID()
    // Tracks whether the alert actually reached the backend vs. was only queued
    // on-device — PanicSubmittedPageClient needs this to avoid claiming "your
    // dispatcher has been notified" when nothing has actually sent yet.
    let queued = false
    try {
      await logException('panic_button', {
        description,
        triggeredAt,
        gpsLat: fix?.latitude ?? null,
        gpsLng: fix?.longitude ?? null,
        ...(fix ? { driverCapturedAt: fix.capturedAt, driverAccuracyMetres: fix.accuracy } : {}),
        clientReportId,
      })
    } catch (err) {
      // Emergency action — don't strand the driver on this screen if the network call
      // fails. Queue it for retry on reconnect (same mechanism handshakes use) instead
      // of just logging and losing it, since this is the one alert that must land.
      // The captured GPS fix goes into the queued body too — the retry must carry the
      // same evidence the live send would have, or the "location will be included"
      // promise silently breaks exactly when the driver is offline and most at risk.
      console.error('Failed to send panic alert to backend — queued for retry', err)
      if (!trip) {
        setSaveFailed(true)
        setSending(false)
        return
      }
      const phaseEventId = contextPhaseEventId(trip.phases)
      const enqueueResult = await enqueueException(String(trip.id), {
        exception_type: 'panic_button',
        description,
        client_report_id: clientReportId,
        // Resolved HERE, not at flush time. This entry can sit in the queue until the
        // driver regains signal — possibly after they have arrived and the trip has
        // moved on — and the alert has to keep saying where the driver actually was
        // when they pressed it, not where the trip ended up.
        ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
        // Both-or-neither: the backend 422s a partial fix, which would make the
        // queue drop this entry as a terminal failure — send the pair or nothing.
        ...(fix
          ? {
              gps_lat: fix.latitude,
              gps_lng: fix.longitude,
              driver_captured_at: fix.capturedAt,
              driver_accuracy_metres: fix.accuracy,
            }
          : {}),
      })
      if (!enqueueResult.persisted) {
        setSaveFailed(true)
        setSending(false)
        return
      }
      queued = true
    }
    // The sent/saved screen states this alert's own facts: when, and whether a position
    // went with it.
    router.replace(ROUTES.panicSubmittedUrl(queued, { at: triggeredAt, located: fix !== null }))
  }

  if (isLoading) {
    // A blank screen here reads as a dead app — on the PANIC page of all places, the
    // driver must see the app is alive. Same LoadingScreen every other waiting screen uses.
    return <LoadingScreen label="Loading trip" />
  }

  if (!trip) {
    return (
      <main className="flex min-h-dvh flex-col bg-surface px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[calc(env(safe-area-inset-top)+4rem)]">
        <div className="flex flex-1 flex-col items-center text-center">
          <span className="flex size-24 items-center justify-center rounded-full bg-error-tint text-error">
            <TriangleAlert className="size-11" strokeWidth={1.7} aria-hidden />
          </span>
          <h1 className="mt-6 text-title-1 tracking-tight text-surface-on">Unable to verify trip</h1>
          <p className="mt-2.5 text-body text-surface-on-variant">
            We could not confirm this panic alert against your active trip.
            Contact dispatch directly for emergency assistance.
          </p>
        </div>
        <CallDispatch />
        <Button type="button" variant="fill" size="pill" className="mt-2.5" onClick={cancel}>
          Back to In Transit
        </Button>
      </main>
    )
  }

  return (
    // White, with one red control (D5, Tim 14 Oct): the screen stays calm and readable;
    // the urgency lives in the swipe and, while a finger is on it, the pulse.
    <main className="relative flex min-h-dvh flex-col bg-surface">
      {pressed && (
        // See-through and inert (pointer-events-none): every word and control stays
        // readable and usable under it. Reduced motion holds it at a steady tint.
        <div
          data-panic-pulse
          aria-hidden
          className="pointer-events-none fixed inset-0 z-overlay animate-panic-pulse bg-error/10 shadow-[inset_0_0_120px_40px_rgb(var(--fp-error)/0.45)] motion-reduce:animate-none"
        />
      )}

      <header className="px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel, back to In Transit"
          className="flex size-11 items-center justify-center rounded-full bg-fill text-surface-on active:scale-95"
        >
          <ChevronLeft className="size-6 -translate-x-px" strokeWidth={2.25} aria-hidden />
        </button>
      </header>

      <div className="flex flex-col items-center px-7 pt-7 text-center">
        <span className="flex size-28 items-center justify-center rounded-full bg-error-tint">
          <span className="flex size-20 items-center justify-center rounded-full bg-error text-error-on">
            <ShieldAlert className="size-10" strokeWidth={1.9} aria-hidden />
          </span>
        </span>
        <h1 className="mt-6 text-large-title font-extrabold tracking-tight text-error">Panic alert</h1>
        {/* Read by someone who may be frightened: what to do, that it goes at once, and
            what goes with it — then, with a finger down, only how to back out. */}
        <p aria-live="polite" className="mt-2.5 text-body text-surface-on-variant">
          {pressed
            ? 'Keep going. Let go to cancel.'
            : 'Swipe to alert your dispatcher. It sends at once, with your location if your phone can find it in time.'}
        </p>
        {sending && (
          <p className="mt-2 text-subhead font-semibold text-surface-on" role="status">
            Sending alert…
          </p>
        )}
        {saveFailed && (
          <p className="mt-3 rounded-xl bg-error-tint px-4 py-3 text-subhead font-semibold text-error" role="alert">
            This alert was not sent or saved. Contact dispatch directly, free device storage, then try again.
          </p>
        )}
      </div>

      <dl className="mx-5 mt-7 divide-y divide-hairline rounded-[18px] bg-fill px-4">
        <div className="grid min-h-12 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
          <MapPin className="size-5 text-surface-on" strokeWidth={1.9} aria-hidden />
          <dt className="text-body text-surface-on">Your location</dt>
          <dd className={cn('text-subhead', locationStatus === 'found' ? 'font-semibold text-success-ink' : 'text-surface-on-variant')}>
            {LOCATION_LABEL[locationStatus]}
          </dd>
        </div>
        <div className="grid min-h-12 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
          <Route className="size-5 text-surface-on" strokeWidth={1.9} aria-hidden />
          <dt className="text-body text-surface-on">Trip</dt>
          <dd className="text-subhead tabular-nums text-surface-on-variant">{trip.trip_reference}</dd>
        </div>
      </dl>

      <div className="mt-auto px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-8">
        {/* No duration weighting: deliberateness comes from the drag distance and
            threshold (or two key presses on the keyboard path). */}
        <SwipeToConfirm
          label="Swipe to Send Panic"
          onConfirm={handlePanic}
          onPressChange={setPressed}
          variant="danger"
        />
        <Button type="button" variant="fill" size="pill" className="mt-3" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </main>
  )
}
