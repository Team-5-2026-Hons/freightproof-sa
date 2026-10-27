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
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import { openDriverExceptions } from '@/lib/utils/trip-attention'
import { ExceptionCard } from '@/components/trip/ExceptionCard'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import { LocationCheckModal } from '@/components/phase/LocationCheckModal'
import { useBack } from '@/lib/navigation/useBack'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { useTripRoute } from '@/lib/hooks/useTripRoute'
import { estimateArrival, legForPhase, type RouteEstimate } from '@/lib/route/eta'
import { directionsUrl } from '@/lib/utils/directions'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

const POSITION_REFRESH_MS = 15_000

const EXCEPTION_LIST_MAX_HEIGHT = 'max-h-36'

const LARGE_TEXT_SHEET_MAX_HEIGHT = 'max-h-[60dvh] overflow-y-auto overscroll-contain'

const FALLBACK_SAFE_CENTRE = 'justify-start [&>:first-child]:mt-auto [&>:last-child]:mb-auto'

interface DriverFix {
  position: DriverPosition
  capturedAt: string
}

export default function InTransitPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.activeTripDetail)
  const largeText = useAccessibilityTextSize()
  const { trip, isLoading, exceptions, refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing, noteTripHandedOver } = useTrip()
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
  const route = useTripRoute(trip === null ? null : String(trip.id))

  const refreshFix = useCallback(async (): Promise<void> => {
    const position = await capturePosition()
    if (position === null) return
    setFix({ position, capturedAt: new Date().toISOString() })
  }, [capturePosition])

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

  const openExceptions = openDriverExceptions(exceptions)

  const tripId = String(trip.id)
  const phases = trip.phases

  const arrivalPhase = currentPhase(phases)

  const leg = legForPhase(route, arrivalPhase)
  const estimate = leg !== null && fix !== null
    ? estimateArrival({ leg, position: fix.position, departedAt: trip.actual_departure_at, now: new Date() })
    : null

  function handleArrivalOutcome(outcome: PhaseSubmissionOutcome, phaseEventId: string) {
    switch (outcome.kind) {
      case 'recorded': {
        if (outcome.trip !== null) {
          adoptTrip(outcome.trip)
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
        return
      }
      case 'conflict':
      case 'failed': {
        clearPhaseSyncing(phaseEventId)
        notify({ kind: 'error', title: 'Could not record arrival', body: outcome.message })
        return
      }
      case 'retained': {
        clearPhaseSyncing(phaseEventId)
        notify({ kind: 'error', title: 'Arrival not recorded on the trip', body: outcome.message })
        if (outcome.handedOver && trip !== null) noteTripHandedOver(String(trip.id))
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
    if (arrivalPhase === null || arrivalPhase.phase_type !== 'in_transit') {
      router.push(currentStepRoute(phases))
      return
    }

    const phaseEventId = arrivalPhase.phase_event_id
    startPhaseSubmission({
      tripId,
      phaseEventId,
      phaseType: 'in_transit',
      evidence: { capturedAt: driverCapturedAt },
      idempotencyKey: crypto.randomUUID(),
      driverCapturedAt,
      position: Promise.resolve(position),
      acknowledgement,
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleArrivalOutcome(outcome, phaseEventId),
    })

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
    <main className="relative flex h-dvh flex-col overflow-hidden bg-surface">
      <section aria-label="Your position" className="relative -mb-7 min-h-0 flex-1 bg-fill">
        <DriverMap
          position={fix?.position ?? null}
          capturedAt={fix?.capturedAt ?? null}
          onRetry={() => { void refreshFix() }}
          route={leg?.coordinates ?? null}
          className="h-[calc(100%-1.75rem)] w-full rounded-none"
          handoffClassName={cn('left-4 top-auto bottom-12', largeText && 'hidden')}
          fallbackClassName={cn(
            'h-[calc(100%-1.75rem)] w-full overflow-y-auto rounded-none px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)]',
            FALLBACK_SAFE_CENTRE,
          )}
          extraAction={navigateUrl !== null && !largeText ? (
            <a
              href={navigateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-3.5 text-subhead font-semibold text-surface-on shadow-ambient-sm active:scale-95"
            >
              <Navigation className="size-4" strokeWidth={2.2} aria-hidden />
              Navigate
            </a>
          ) : undefined}
          extraActionClassName="bottom-12 right-4"
        />
      </section>

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

      <div className={cn(
        'relative z-10 shrink-0 rounded-t-[28px] bg-surface px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-5 shadow-[0_-6px_24px_rgb(0_0_0/0.10)]',
        largeText && LARGE_TEXT_SHEET_MAX_HEIGHT,
      )}>
        <HeadingTo trip={trip} phase={arrivalPhase} estimate={estimate} />

        {openExceptions.length > 0 && (
          <section aria-label="Open exceptions" className="mt-3.5">
            <div className={cn('flex flex-col gap-2 overflow-y-auto overscroll-contain', EXCEPTION_LIST_MAX_HEIGHT)}>
              {openExceptions.map((exc) => (
                <ExceptionCard key={exc.id} exception={exc} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-3.5 flex justify-center">
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
 * Where this leg ends and when it is due — the two facts a driver checks
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
          <p className="text-footnote text-surface-on-variant">Off planned route</p>
        )}
      </div>
    </div>
  )
}
