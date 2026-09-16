'use client'

// The driving screen. A hub, not a step screen — in_transit has no step recipe — but not
// submission-free: the bottom swipe is the driver attesting "I have arrived", which is
// what closes the in_transit row (advance_in_transit).
//
// Layout invariant: panic is never behind a scroll. The action stack is `shrink-0` inside
// an `overflow-hidden` viewport-height column; only the open-exceptions list can grow,
// and it's height-capped and scrolls inside itself.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert, ScanFace, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { useToast } from '@/lib/hooks/useToast'
import { startPhaseSubmission, type PhaseSubmissionOutcome } from '@/lib/submission/phase-submitter'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { currentPhase, currentStepRoute } from '@/lib/phase'
import { Button } from '@/components/ui/Button'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { DriverMap } from '@/components/map/DriverMap'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { DriverPosition } from '@/lib/types/location'
import type { TripException } from '@shared/lib/types/exception'

// How often the map re-reads the phone's position while this screen is open. A truck at
// 100 km/h covers ~400 m in this window, which at street zoom is about a screen height —
// often enough to read as "following", rare enough not to hold the GPS radio awake.
const POSITION_REFRESH_MS = 15_000

// Cap on the open-exceptions list before it scrolls inside itself. This is what keeps the
// panic button on screen no matter how many exceptions a bad leg has accumulated.
const EXCEPTION_LIST_MAX_HEIGHT = 'max-h-36'

interface ExceptionCardProps {
  exception: TripException
}

interface DriverFix {
  position: DriverPosition
  /** When this fix was taken, so a stale one can be labelled as last known. */
  capturedAt: string
}

// A native <button>, not Card, so expand/collapse is keyboard-operable and announces
// state via aria-expanded. Styling mirrors Card variant="exception".
function ExceptionCard({ exception }: ExceptionCardProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full rounded-xl border-l-4 border-error bg-surface-container-lowest p-3 text-left shadow-ambient"
    >
      <p className="text-sm font-semibold text-error-on-container capitalize">
        {exception.exception_type.replace(/_/g, ' ')}
      </p>
      {/* clamped only while collapsed — a tap reveals the full description */}
      <p className={cn('text-xs text-surface-on-variant mt-0.5', !expanded && 'line-clamp-2')}>
        {exception.description}
      </p>
    </button>
  )
}

export default function InTransitPageClient() {
  const router = useRouter()
  const { trip, isLoading, exceptions, refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing } = useTrip()
  const { capturePosition } = useLocationTrail()
  const { enqueuePhase } = useOfflineQueue()
  const { notify } = useToast()
  const [fix, setFix] = useState<DriverFix | null>(null)

  const tripIsOpen = trip !== null

  const refreshFix = useCallback(async (): Promise<void> => {
    const position = await capturePosition()
    // A failed fix must never erase the last good one; DriverMap labels a stale fix as
    // last known rather than passing it off as current.
    if (position === null) return
    setFix({ position, capturedAt: new Date().toISOString() })
  }, [capturePosition])

  // POPIA: narrowest possible tracking window — only while the trip is open, this screen
  // is mounted, and the app is foregrounded. No watchPosition, nothing transmitted; a
  // display read for the driver's own map only.
  useEffect(() => {
    if (!tripIsOpen) return

    void refreshFix()
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshFix()
    }, POSITION_REFRESH_MS)

    return () => window.clearInterval(timer)
  }, [tripIsOpen, refreshFix])

  if (isLoading) {
    return <LoadingScreen label="Loading trip" />
  }

  if (trip === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-lg text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  // Reads the context exceptions list, not trip.exceptions, so a just-submitted exception
  // shows up immediately (trip.exceptions is only a fetch-time snapshot).
  //
  // System-detected exceptions (source: 'system') are withheld from this screen: they're
  // automated, unreviewed detections about the driver and several read as an accusation
  // (e.g. gps_mismatch). The dispatcher still sees every exception regardless.
  const openExceptions = exceptions.filter((e) => e.review_status !== 'reviewed' && e.source !== 'system')

  // Captured here rather than read off `trip` in the nested handlers below: TS's non-null
  // narrowing from the guard above doesn't carry into a function declaration's body.
  const tripId = String(trip.id)
  const phases = trip.phases

  // currentPhase, not actionablePhase: actionablePhase skips stepless rows and would
  // hand back `unloading`, which the driver hasn't reached yet.
  const arrivalPhase = currentPhase(phases)

  // Takes phaseEventId as a parameter rather than closing over arrivalPhase directly, so
  // the caller narrows it to non-null once, at the swipe guard.
  function handleArrivalOutcome(outcome: PhaseSubmissionOutcome, phaseEventId: string) {
    switch (outcome.kind) {
      case 'recorded': {
        if (outcome.trip !== null) {
          adoptTrip(outcome.trip)
          // Reconcile: the real plan already shows this phase resolved, so dropping the
          // optimistic marker changes nothing the driver can see.
          clearPhaseSyncing(phaseEventId)
        }
        return
      }
      case 'hold': {
        // The arrival is recorded, but the swipe already pushed the driver onto the
        // unloading step, which a held trip can only 409 — route back to the trip screen
        // where the hold reason is visible instead. Unreachable today: advance_in_transit
        // never holds. Kept in step with PhaseStepPageClient's reference implementation.
        adoptTrip(outcome.trip)
        clearPhaseSyncing(phaseEventId)
        notify({
          kind: 'error',
          title: 'Trip on hold',
          body: 'A critical exception was recorded. The trip is paused for dispatcher review.',
        })
        router.push(ROUTES.activeTripDetail)
        return
      }
      case 'queued': {
        // Optimistic advance kept: the queue holds and replays the attestation.
        return
      }
      case 'conflict':
      case 'failed': {
        // No draft to roll back to — an arrival carries only a timestamp and position.
        clearPhaseSyncing(phaseEventId)
        notify({ kind: 'error', title: 'Could not record arrival', body: outcome.message })
        return
      }
      default: {
        const unreachable: never = outcome
        throw new Error(`handleArrivalOutcome: unhandled outcome "${String(unreachable)}"`)
      }
    }
  }

  function handleArrivalSwipe() {
    // Defensive against a stale tab whose ledger already moved on (arrival recorded
    // elsewhere) — navigating is still right, there's just nothing left here to submit.
    if (arrivalPhase === null || arrivalPhase.phase_type !== 'in_transit') {
      router.push(currentStepRoute(phases))
      return
    }

    const phaseEventId = arrivalPhase.phase_event_id
    const driverCapturedAt = new Date().toISOString()

    // Return value ignored: `false` just means a submission for this row is already
    // running, and the right response is still to navigate.
    startPhaseSubmission({
      tripId,
      phaseEventId,
      phaseType: 'in_transit',
      evidence: { capturedAt: driverCapturedAt },
      idempotencyKey: crypto.randomUUID(),
      driverCapturedAt,
      // Un-awaited: a cold GPS fix can take seconds and must never delay the transition.
      // The submitter awaits it internally, so the fix still travels with the evidence.
      //
      // Known/accepted race: unloading can 409 if submitted before this POST lands, since
      // the backend enforces ledger ordering. Recoverable — phase-submitter refetches and
      // PhaseStepPageClient rolls back the draft — so the cost is one spurious toast.
      position: capturePosition(),
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleArrivalOutcome(outcome, phaseEventId),
    })

    // Mark before navigating, so Home's first render already sees this row resolved.
    markPhaseSyncing(phaseEventId)
    router.push(currentStepRoute(phases))
  }

  return (
    // dvh, not vh: 100vh resolves to the address-bar-hidden height and would push the
    // action stack off the bottom.
    <main className="flex h-dvh flex-col overflow-hidden">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="Trip detail"
        onBack={() => router.push(ROUTES.activeTripDetail)}
        right={<span className="text-sm text-surface-on-variant">In Transit</span>}
      />

      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 py-2">
        <p className="text-sm uppercase tracking-industrial text-surface-on-variant">Planned arrival</p>
        <p className="text-base font-semibold text-surface-on">
          {trip.planned_arrival_at ? formatTime(trip.planned_arrival_at) : 'Not set'}
        </p>
      </div>

      {/* min-h-0 is load-bearing: without it a flex child won't shrink below its content
          and pushes the action stack off the bottom. */}
      <section className="min-h-0 flex-1 px-4 pb-3">
        <DriverMap
          position={fix?.position ?? null}
          capturedAt={fix?.capturedAt ?? null}
          onRetry={() => { void refreshFix() }}
          className="h-full w-full"
        />
      </section>

      <div className="shrink-0 border-t border-outline-variant/60 bg-surface-container-lowest px-4 pt-3 pb-safe">
        {openExceptions.length > 0 && (
          <section className="mb-3 flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-error">
              <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            {/* Height-capped and self-scrolling so a bad leg can't push panic below the fold. */}
            <div className={cn('flex flex-col gap-2 overflow-y-auto overscroll-contain', EXCEPTION_LIST_MAX_HEIGHT)}>
              {openExceptions.map((exc) => (
                <ExceptionCard key={exc.id} exception={exc} />
              ))}
            </div>
          </section>
        )}

        {/* Swipe, not a tap: this gesture opens the truck and starts evidence capture, so
            a single accidental tap must never be enough to trigger it. */}
        <div className="flex justify-center">
          <SwipeToConfirm label="Arrive at destination" onConfirm={handleArrivalSwipe} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="lg"
            iconLeft={<ScanFace className="h-4 w-4" strokeWidth={2} aria-hidden />}
            onClick={() => router.push(ROUTES.checkpoint)}
          >
            Checkpoint
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => router.push(ROUTES.exception)}
          >
            Log exception
          </Button>
        </div>

        <Button
          variant="danger"
          size="lg"
          className="mt-3"
          iconLeft={<ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.panic)}
        >
          Panic
        </Button>
      </div>
    </main>
  )
}
