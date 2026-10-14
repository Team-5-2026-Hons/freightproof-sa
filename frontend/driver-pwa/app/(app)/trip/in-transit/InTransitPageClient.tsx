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
// map takes whatever is left, which on any phone is the largest element on screen — the
// driver's choice in the design review, over a fixed strip.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Navigation, PackageCheck, ShieldAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { useLocation } from '@/lib/hooks/useLocation'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { useToast } from '@/lib/hooks/useToast'
import { startPhaseSubmission, type PhaseSubmissionOutcome } from '@/lib/submission/phase-submitter'
import { previewPhaseLocation } from '@/lib/api/phases'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { currentPhase, currentStepRoute, phaseLocation } from '@/lib/phase'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { DriverMap } from '@/components/map/DriverMap'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import type { DriverPosition } from '@/lib/types/location'
import type { LocationWarningAcknowledgement } from '@/lib/types/location'
import { openDriverExceptions } from '@/lib/utils/trip-attention'
import { ExceptionCard } from '@/components/trip/ExceptionCard'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { TripException } from '@shared/lib/types/exception'
import { LocationCheckModal } from '@/components/phase/LocationCheckModal'
import { useBack } from '@/lib/navigation/useBack'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { useTripRoute } from '@/lib/hooks/useTripRoute'
import { estimateArrival, legForPhase, type RouteEstimate } from '@/lib/route/eta'
import { directionsUrl } from '@/lib/utils/directions'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// How often the map re-reads the phone's position while this screen is open. A truck at
// 100 km/h covers ~400 m in this window, which at street zoom is about a screen height —
// often enough to read as "following", rare enough not to hold the GPS radio awake.
const POSITION_REFRESH_MS = 15_000

// Cap on the open-exceptions list before it scrolls inside itself. This is what keeps the
// panic button on screen no matter how many exceptions a bad leg has accumulated.
const EXCEPTION_LIST_MAX_HEIGHT = 'max-h-36'

interface DriverFix {
  position: DriverPosition
  /** When this fix was taken, so a stale one can be labelled as last known. */
  capturedAt: string
}

export default function InTransitPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.activeTripDetail)
  const largeText = useAccessibilityTextSize()
  const { trip, isLoading, exceptions, refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing } = useTrip()
  const { capturePosition } = useLocationTrail()
  const { capture } = useLocation()
  const { enqueuePhase } = useOfflineQueue()
  const { notify } = useToast()
  const [fix, setFix] = useState<DriverFix | null>(null)
  const [arrivalPreviewLoading, setArrivalPreviewLoading] = useState(false)
  const [arrivalPreviewError, setArrivalPreviewError] = useState<string | null>(null)
  const [arrivalAssessment, setArrivalAssessment] = useState<ActionLocationAssessment | null>(null)
  const [arrivalPosition, setArrivalPosition] = useState<DriverPosition | null>(null)
  const [arrivalCapturedAt, setArrivalCapturedAt] = useState<string | null>(null)
  const [arrivalOffline, setArrivalOffline] = useState(false)

  const tripIsOpen = trip !== null
  // Called above the early returns, with a nullable id, so hook order never changes.
  const route = useTripRoute(trip === null ? null : String(trip.id))

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
  //
  // System-detected exceptions (source: 'system' — gps_mismatch, route_deviation,
  // checkpoint_timeout and the rest) are withheld from the driver's own screen. These are
  // automated detections ABOUT the driver, raised without human review, and several of
  // them read as an accusation: gps_mismatch says the phone and the truck disagree about
  // where they are. Surfacing an unreviewed detection to the person it concerns invites
  // them to react to it on the road, which is the opposite of what this hub is for. The
  // dispatcher sees every exception regardless — nothing is hidden from the evidence
  // trail, only from this one screen. Driver- and dispatcher-raised exceptions stay
  // visible: those the driver either filed themselves or is meant to act on.
  const openExceptions = openDriverExceptions(exceptions)

  // Captured here, in component scope, rather than read off `trip` inside the nested
  // handlers below — TS narrows `trip` to non-null in this scope (the guard above), but
  // does not carry that narrowing into a function declaration's body.
  const tripId = String(trip.id)
  const phases = trip.phases

  // The in_transit row this hub is standing on. currentPhase, not actionablePhase:
  // actionablePhase deliberately skips stepless rows and would hand back `unloading`,
  // which is the row the driver has NOT reached yet.
  const arrivalPhase = currentPhase(phases)

  // The leg being driven and the ETA along it. Recomputed on every render, which is every
  // fresh fix (POSITION_REFRESH_MS) — cheap: one pass over a few thousand points.
  const leg = legForPhase(route, arrivalPhase)
  const estimate = leg !== null && fix !== null
    ? estimateArrival({ leg, position: fix.position, departedAt: trip.actual_departure_at, now: new Date() })
    : null

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
        const assessment = outcome.addressedPhase?.action_location_assessment
        if (assessment !== null && assessment !== undefined && (
          (assessment.proximity === 'separated' && assessment.separation_metres !== null)
          || assessment.truck_in_precinct === false
          || assessment.driver_in_precinct === false
        )) {
          notify({
            kind: 'error',
            title: 'Location warning recorded',
            body: 'The final location check found a discrepancy. Your arrival was still recorded for review.',
          })
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

  function submitArrival(
    position: DriverPosition | null,
    driverCapturedAt: string,
    acknowledgement: LocationWarningAcknowledgement | null,
  ): void {
    // Defensive against a stale tab whose ledger has already moved on (e.g. arrival was
    // recorded from another device/tab). Navigating is still right — the arrival is
    // already recorded, there is simply nothing left here to submit.
    if (arrivalPhase === null || arrivalPhase.phase_type !== 'in_transit') {
      router.push(currentStepRoute(phases))
      return
    }

    const phaseEventId = arrivalPhase.phase_event_id
    // The same "swipe instant" evidence.capturedAt below already stamps — reused
    // here rather than taken a second time, so both fields describe the identical moment.
    // Return value deliberately ignored: `false` means a submission for this row is
    // already running, and the right response is still to navigate — the attestation is
    // already on its way.
    startPhaseSubmission({
      tripId,
      phaseEventId,
      phaseType: 'in_transit',
      evidence: { capturedAt: driverCapturedAt },
      idempotencyKey: crypto.randomUUID(),
      driverCapturedAt,
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
      position: Promise.resolve(position),
      acknowledgement,
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleArrivalOutcome(outcome, phaseEventId),
    })

    // Order matters: mark before navigating, so Home's very first render already sees
    // this row resolved rather than still pending with isDriving() still true.
    markPhaseSyncing(phaseEventId)
    router.push(currentStepRoute(phases))
  }

  async function handleArrivalSwipe(): Promise<void> {
    if (arrivalPreviewLoading) return
    const attemptStartedAt = new Date().toISOString()
    setArrivalPreviewLoading(true)
    setArrivalPreviewError(null)
    setArrivalAssessment(null)
    setArrivalPosition(null)
    setArrivalCapturedAt(null)

    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    setArrivalOffline(offline)
    const coords = await capture()
    if (coords === null) {
      setArrivalCapturedAt(attemptStartedAt)
      setArrivalPreviewLoading(false)
      return
    }
    const position: DriverPosition = {
      lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy, capturedAt: coords.capturedAt,
    }
    setArrivalPosition(position)
    setArrivalCapturedAt(coords.capturedAt)
    if (offline) {
      // The preview is an online advisory check only. The exact offline capture still
      // belongs to this arrival evidence and is queued with its original timestamp.
      setArrivalPreviewLoading(false)
      return
    }
    try {
      const assessment = await previewPhaseLocation(tripId, arrivalPhase?.phase_event_id ?? '', {
        lat: position.lat,
        lng: position.lng,
        accuracy_metres: position.accuracyM,
        captured_at: coords.capturedAt,
      })
      const requiresAcknowledgement =
        (assessment.proximity === 'separated' && assessment.separation_metres !== null)
        || assessment.truck_in_precinct === false
        || assessment.driver_in_precinct === false
      if (requiresAcknowledgement || assessment.proximity === 'unverified') {
        setArrivalAssessment(assessment)
      } else {
        // Cleared before hand-off, not left for the next handleArrivalSwipe() call —
        // see PhaseStepPageClient's identical reset for why a stale arrivalCapturedAt
        // would otherwise reopen LocationCheckModal against a `null` assessment one
        // render after a clean pass.
        setArrivalCapturedAt(null)
        setArrivalPosition(null)
        submitArrival(position, coords.capturedAt, null)
      }
    } catch (err) {
      console.error('InTransitPageClient: location preview failed', err)
      setArrivalPreviewError('Location preview failed')
    } finally {
      setArrivalPreviewLoading(false)
    }
  }

  function continueArrivalAfterLocationCheck(reason: string | null): void {
    const acknowledgement = reason === null
      ? null
      : { acknowledgedAt: new Date().toISOString(), reason }
    submitArrival(arrivalPosition, arrivalCapturedAt ?? new Date().toISOString(), acknowledgement)
  }

  const navigateUrl = directionsUrl(trip.destination_precinct_id)

  return (
    // h-dvh + overflow-hidden: this screen IS one viewport. Only the exceptions list may
    // scroll, inside the sheet. dvh, not vh — 100vh resolves to the address-bar-hidden
    // height in a mobile browser and would push the sheet off the bottom.
    <main className="relative flex h-dvh flex-col overflow-hidden bg-surface">
      {/* The map, full-bleed (overhaul 6.1): it takes every pixel the sheet does not, up
          under the status bar. The sheet's rounded top overlaps it by its own radius
          (-mb-7); the map itself stops short of that overlap so Google's logo, bottom
          left, is never covered. min-h-0 is load-bearing — without it a flex child
          refuses to shrink and pushes the sheet off the bottom. */}
      <section aria-label="Your position" className="relative -mb-7 min-h-0 flex-1 bg-fill">
        <DriverMap
          position={fix?.position ?? null}
          capturedAt={fix?.capturedAt ?? null}
          onRetry={() => { void refreshFix() }}
          route={leg?.coordinates ?? null}
          className="h-[calc(100%-1.75rem)] w-full rounded-none"
          // Bottom left, 3rem up: clear of the floating Back button and of Google's logo.
          // Hidden at accessibility text sizes: the map is short there and a chip in its
          // lower half meets the floating Back and Panic controls. Navigate moves into the
          // sheet instead (below).
          handoffClassName={cn('left-4 top-auto bottom-12', largeText && 'hidden')}
          // The fallback cards carry text and a button; they start below the floating
          // controls and scroll inside the map's slot on a short phone.
          fallbackClassName="h-[calc(100%-1.75rem)] w-full overflow-y-auto rounded-none px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)]"
        />
        {navigateUrl !== null && !largeText && (
          // A real anchor: a WebView hands maps:/google.navigation: schemes to the OS only
          // from a link, and this is a hand-off to the driver's own navigation app.
          <a
            href={navigateUrl}
            target="_blank"
            rel="noopener noreferrer"
            // 3rem above the map's own bottom edge (which sits 1.75rem up the section), the
            // same height as the map's Open in Maps chip, clear of Google's attribution.
            className="absolute bottom-[4.75rem] right-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-3.5 text-subhead font-semibold text-surface-on shadow-ambient-sm active:scale-95"
          >
            <Navigation className="size-4" strokeWidth={2.2} aria-hidden />
            Navigate
          </a>
        )}
      </section>

      {/* Floating over the map, under the status bar: the way back on the left, and
          Panic on the right — red, labelled, and never inside anything that scrolls. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-surface text-surface-on shadow-ambient-sm active:scale-95"
        >
          <ChevronLeft className="size-6 -translate-x-px" strokeWidth={2.25} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => router.push(ROUTES.panic)}
          className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-error pl-3 pr-4 text-subhead font-bold text-error-on shadow-ambient-sm active:scale-95"
        >
          <ShieldAlert className="size-5" strokeWidth={2.2} aria-hidden />
          Panic
        </button>
      </div>

      {/* Everything the driver can do, on a sheet that never scrolls away. */}
      <div className="relative z-10 shrink-0 rounded-t-[28px] bg-surface px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-5 shadow-[0_-6px_24px_rgb(0_0_0/0.10)]">
        <HeadingTo trip={trip} phase={arrivalPhase} estimate={estimate} />

        {openExceptions.length > 0 && (
          // No count eyebrow: each card names its own kind.
          <section aria-label="Open exceptions" className="mt-3.5">
            {/* Height-capped and self-scrolling: a leg with eight exceptions must not be
                able to push the swipe off the screen. */}
            <div className={cn('flex flex-col gap-2 overflow-y-auto overscroll-contain', EXCEPTION_LIST_MAX_HEIGHT)}>
              {openExceptions.map((exc) => (
                <ExceptionCard key={exc.id} exception={exc} />
              ))}
            </div>
          </section>
        )}

        {/* The way out of this screen, and — since 2026-08-09 — the record that the drive
            ended. currentStepRoute (lib/phase) is what skips the stepless in_transit row
            the driver is standing on; a caller that stopped at the current phase would
            loop straight back here. Swipe, not a tap: a single accidental tap must never
            open the truck's evidence capture. */}
        <div className="mt-3.5 flex justify-center">
          {/* Removed entirely (not merely covered by the sheet) while a check is in flight
              or awaiting a decision — an unmounted control cannot be swiped twice. */}
          {!(arrivalPreviewLoading || arrivalCapturedAt !== null) && (
            <SwipeToConfirm label="Swipe to Arrive" onConfirm={() => { void handleArrivalSwipe() }} />
          )}
          <LocationCheckModal
            open={arrivalPreviewLoading || arrivalCapturedAt !== null}
            assessment={arrivalAssessment}
            loading={arrivalPreviewLoading}
            error={arrivalPreviewError}
            offline={arrivalOffline}
            onRetry={() => { void handleArrivalSwipe() }}
            onContinue={continueArrivalAfterLocationCheck}
          />
        </div>

        {/* Secondary actions as grey pills, ranked visibly below the swipe. */}
        {/* Two side by side while they fit; stacked at accessibility text sizes rather
            than letting the labels spill out of their pills. */}
        <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
          <button
            type="button"
            onClick={() => router.push(ROUTES.checkpoint)}
            className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-fill text-body font-semibold text-surface-on active:scale-[0.98] active:bg-surface-container-high"
          >
            <PackageCheck className="size-5" strokeWidth={2} aria-hidden />
            Checkpoint
          </button>
          <button
            type="button"
            onClick={() => router.push(ROUTES.exception)}
            aria-label="Log exception"
            className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-fill text-body font-semibold text-surface-on active:scale-[0.98] active:bg-surface-container-high"
          >
            <TriangleAlert className="size-5" strokeWidth={2} aria-hidden />
            Exception
          </button>
          {navigateUrl !== null && largeText && (
            // At accessibility text sizes Navigate lives here, with the other actions,
            // rather than floating over a map too short to hold it clear of Panic.
            <a
              href={navigateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-fill text-body font-semibold text-surface-on active:scale-[0.98]"
            >
              <Navigation className="size-5" strokeWidth={2} aria-hidden />
              Navigate
            </a>
          )}
        </div>
      </div>
    </main>
  )
}

/** "640 km", "8.4 km", "350 m" — coarser as the number grows, since precision past that is noise. */
function formatRemaining(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`
  const km = metres / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

/**
 * Where this leg ends and when it is due (overhaul 6.1) — the two facts a driver checks
 * most, at the top of the sheet. The leg's end comes from the plan: the destination, or
 * on a cross-dock plan the next stop, named by position when no name is known.
 *
 * The ETA is the on-device route estimate when there is one. Off the planned route, or
 * with no route at all, it falls back to the trip's planned arrival — and says which.
 */
function HeadingTo({ trip, phase, estimate }: { trip: Trip; phase: PhaseDescriptor | null; estimate: RouteEstimate | null }) {
  const places = useTripPlaces(trip)
  const where = phase === null ? null : phaseLocation(trip.phases, phase)
  const place = where === null || where === 'To Destination'
    ? places.destination
    : { name: where.replace(/^To /, ''), detail: null }
  const onRoute = estimate?.kind === 'on_route' ? estimate : null
  return (
    <div className="flex items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <p className="text-subhead text-surface-on-variant">Heading to</p>
        <p className="truncate text-title-2 tracking-tight text-surface-on">{place.name}</p>
        {place.detail !== null && <p className="truncate text-subhead text-surface-on-variant">{place.detail}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-subhead text-surface-on-variant">ETA</p>
        {onRoute !== null
          ? <p className="text-title-1 tabular-nums text-surface-on">{formatTime(onRoute.arrivalAt)}</p>
          : trip.planned_arrival_at !== null
            ? <p className="text-title-1 tabular-nums text-surface-on">{formatTime(trip.planned_arrival_at)}</p>
            : <p className="text-headline text-surface-on-variant">Not set</p>}
        {onRoute !== null && (
          <p className="text-footnote tabular-nums text-surface-on-variant">{formatRemaining(onRoute.remainingMetres)} to go</p>
        )}
        {estimate?.kind === 'off_route' && (
          // Not a warning: detours are normal. It explains why the ETA went back to the plan.
          <p className="text-footnote text-surface-on-variant">Off planned route</p>
        )}
      </div>
    </div>
  )
}
