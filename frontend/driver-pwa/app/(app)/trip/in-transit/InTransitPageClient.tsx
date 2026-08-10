// frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx
'use client'

// The driving screen — the part of the trip where the driver is actually moving.
//
// It is a hub, not a step screen — `in_transit` has no step recipe and never will: a
// recipe would perturb actionablePhase() and force a change to the shared STEP_SLUGS
// contract. But it is NOT submission-free. The swipe at the bottom is the driver
// attesting "I have arrived", and since 2026-08-09 that attestation is what closes the
// in_transit row — previously the backend inferred arrival from whenever the unloading
// paperwork happened to be submitted, which made every dispatcher-visible drive time
// wrong by the length of an unloading.
//
// Navigation still tests isDriving() (lib/phase/derive.ts), which is now simply "the
// current row is in_transit".
//
// Layout invariant: PANIC IS NEVER BEHIND A SCROLL. The action stack at the bottom is
// `shrink-0` inside an `overflow-hidden` viewport-height column, and the only part of it
// that can grow (the open-exceptions list) is height-capped and scrolls inside itself. The
// map takes whatever is left, which on any phone is the largest element on screen.

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

// A native <button> (not the Card component) so the expand/collapse toggle is
// keyboard-operable and announces its state via aria-expanded — long exception and
// dispatcher-note descriptions were previously clamped with no way to read the rest.
// Styling mirrors Card variant="exception".
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
    // A failed fix must never erase the last good one. A driver in a cutting or under a
    // bridge still needs to see where they last were — and DriverMap labels an old fix
    // as last known rather than passing it off as current.
    if (position === null) return
    setFix({ position, capturedAt: new Date().toISOString() })
  }, [capturePosition])

  // POPIA (see the constraints in lib/context/LocationContext.tsx's header): this is the
  // narrowest possible tracking window. It runs only while a trip is OPEN, only while
  // this screen is MOUNTED, and only while the app is in the FOREGROUND — no
  // watchPosition subscription, no background-location permission, and nothing captured
  // here is transmitted anywhere. It is a display read for the driver's own map.
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

  // Read the CONTEXT exceptions list, not trip.exceptions: the context value is the
  // trip's fetched/mock exceptions plus everything logged this session (TripContext
  // appends on logException), so a just-submitted exception shows up here immediately.
  // trip.exceptions is only a fetch-time snapshot and would silently drop it.
  const openExceptions = exceptions.filter((e) => !e.resolved)

  // Captured here, in component scope, rather than read off `trip` inside the nested
  // handlers below — TS narrows `trip` to non-null in this scope (the guard above), but
  // does not carry that narrowing into a function declaration's body.
  const tripId = String(trip.id)
  const phases = trip.phases

  // The in_transit row this hub is standing on. currentPhase, not actionablePhase:
  // actionablePhase deliberately skips stepless rows and would hand back `unloading`,
  // which is the row the driver has NOT reached yet.
  const arrivalPhase = currentPhase(phases)

  // Runs from wherever the driver has since navigated to (background submitter model —
  // see PhaseStepPageClient's identical handleOutcome for the reference implementation).
  // Takes phaseEventId as a parameter (rather than closing over arrivalPhase directly) so
  // the caller narrows arrivalPhase to non-null once, at the swipe guard, instead of this
  // function asserting it.
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
        // Split from 'recorded' rather than folded into it, mirroring
        // PhaseStepPageClient.handleOutcome. The arrival itself is recorded, but the
        // swipe has already pushed the driver onto the unloading step — and a held trip
        // can only 409 there. Landing them on a capture screen they cannot submit, with
        // no explanation, is the wrong failure direction; the trip screen is where the
        // hold reason is visible.
        //
        // Unreachable today: advance_in_transit never holds, and nothing in backend app/
        // writes TripStatus.EXCEPTION_HOLD at all (see _is_resolved's note). Kept in step
        // with the reference implementation anyway, so a future manual dispatcher hold
        // does not have to remember this one screen diverged.
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
        // Optimistic advance deliberately KEPT: the queue holds the attestation and will
        // replay it, so re-offering the swipe would only invite a second copy.
        return
      }
      case 'conflict':
      case 'failed': {
        // No draft to preserve or roll back to — an arrival carries no captured
        // evidence, only a timestamp and a position. Rolling the marker back just makes
        // the row unresolved again so the swipe can be offered a second time.
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
    // Defensive against a stale tab whose ledger has already moved on (e.g. arrival was
    // recorded from another device/tab). Navigating is still right — the arrival is
    // already recorded, there is simply nothing left here to submit.
    if (arrivalPhase === null || arrivalPhase.phase_type !== 'in_transit') {
      router.push(currentStepRoute(phases))
      return
    }

    const phaseEventId = arrivalPhase.phase_event_id

    // Return value deliberately ignored: `false` means a submission for this row is
    // already running, and the right response is still to navigate — the attestation is
    // already on its way.
    startPhaseSubmission({
      tripId,
      phaseEventId,
      phaseType: 'in_transit',
      evidence: { capturedAt: new Date().toISOString() },
      idempotencyKey: crypto.randomUUID(),
      // Un-awaited: a cold GPS fix can take ten seconds and must never sit between the
      // swipe and the transition. The submitter awaits it internally, so the fix still
      // travels WITH the evidence, including into the offline queue.
      //
      // Known race, accepted: the submitter holds this POST for up to
      // POSITION_CAPTURE_BUDGET_MS (12s) waiting on the fix, while the driver is already
      // on the unloading step. Submitting unloading inside that window 409s, because the
      // backend now enforces ledger ordering and the arrival has not landed yet. It is
      // recoverable — phase-submitter refetches, sees unloading unresolved, returns
      // `conflict`, and PhaseStepPageClient keeps the draft and rolls back — so the cost
      // is one spurious error toast, not lost evidence. Left as-is rather than awaited:
      // this screen has been refreshing position every POSITION_REFRESH_MS while open, so
      // the fix is warm and the real window is sub-second, and unloading's first step
      // needs a seal photograph before it can submit at all.
      position: capturePosition(),
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleArrivalOutcome(outcome, phaseEventId),
    })

    // Order matters: mark before navigating, so Home's very first render already sees
    // this row resolved rather than still pending with isDriving() still true.
    markPhaseSyncing(phaseEventId)
    router.push(currentStepRoute(phases))
  }

  return (
    // h-dvh + overflow-hidden: this screen IS one viewport and nothing on it scrolls
    // except the exceptions list. dvh, not vh — 100vh resolves to the address-bar-hidden
    // height in a mobile browser and would push the action stack off the bottom.
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

      {/* The map, and the largest element on the screen: it takes every pixel the header
          and the action stack do not need. min-h-0 is load-bearing — without it a flex
          child refuses to shrink below its content and pushes the stack off the bottom. */}
      <section className="min-h-0 flex-1 px-4 pb-3">
        <DriverMap
          position={fix?.position ?? null}
          capturedAt={fix?.capturedAt ?? null}
          onRetry={() => { void refreshFix() }}
          className="h-full w-full"
        />
      </section>

      {/* Everything the driver can do, in a block that never scrolls away. */}
      <div className="shrink-0 border-t border-outline-variant/60 bg-surface-container-lowest px-4 pt-3 pb-safe">
        {openExceptions.length > 0 && (
          <section className="mb-3 flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-error">
              <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            {/* Height-capped and self-scrolling: a leg with eight exceptions must not be
                able to push the panic button below the fold. */}
            <div className={cn('flex flex-col gap-2 overflow-y-auto overscroll-contain', EXCEPTION_LIST_MAX_HEIGHT)}>
              {openExceptions.map((exc) => (
                <ExceptionCard key={exc.id} exception={exc} />
              ))}
            </div>
          </section>
        )}

        {/* The way out of this screen, and — since 2026-08-09 — the record that the drive
            ended. The driver already performs this gesture; the system used to discard
            it and infer arrival later from whenever the unloading paperwork happened to
            be submitted. currentStepRoute (lib/phase) is what skips the stepless
            in_transit row the driver is standing on; a caller that stopped at the current
            phase would loop straight back here.
            Swipe, not a tap: this is the gesture that opens the truck and starts evidence
            capture, and a single accidental tap must never be enough to trigger it. */}
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
