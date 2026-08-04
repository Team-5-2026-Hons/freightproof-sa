// frontend/driver-pwa/app/(app)/trips/detail/TripDetailByIdPageClient.tsx
//
// Detail for ONE of the driver's own trips, addressed by ?id=<uuid> (see page.tsx for why
// the id can't be a path segment). Distinct from trips/active, which renders whichever
// trip the session context happens to hold: this screen can open a trip the driver has
// NOT activated yet, which is what makes the Upcoming tab tappable at all.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import { fetchMyTrip } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES, TRIP_ID_PARAM } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TripDetailView } from '@/components/trip/TripDetailView'

// Statuses meaning "this trip is underway" — the driver has activated it. Mirrors the
// backend's own ranking in trip_service.get_active_trip_for_driver.
const UNDERWAY_STATUSES: readonly Trip['status'][] = ['active', 'exception_hold']

// Route to the first step of the selected phase's own recipe. Mirrors
// PhaseStepPageClient.tsx's local currentStepRoute — lib/phase/ itself stays the
// only export surface for sequencing, this is just route composition, kept local to
// each caller the same way that file keeps its own.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves before the
  // driver is ever involved — TripDetailView only ever offers this callback for the
  // current phase, which should never be trip_creation by the time a driver sees it.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.trips
}

export default function TripDetailByIdPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tripId = searchParams.get(TRIP_ID_PARAM)
  const { notify } = useToast()
  // The session's current trip, used only to tell whether a DIFFERENT trip is already
  // underway — a driver runs one trip at a time, so this one can't be started yet.
  const { trip: sessionTrip, selectTrip } = useTrip()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const load = useCallback(() => {
    if (tripId === null) {
      setLoadError('No trip was specified.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    fetchMyTrip(tripId)
      .then(setTrip)
      .catch((err: unknown) => {
        // 404 is the backend refusing to confirm another driver's trip exists, so it and a
        // genuinely missing trip get the same copy. Everything else is a transport problem
        // and says so, rather than claiming the trip is gone.
        const missing = err instanceof ApiError && err.status === 404
        if (!missing) console.error('Failed to load trip detail', err)
        setLoadError(
          missing
            ? 'This trip is no longer assigned to you.'
            : 'Could not load this trip. Check your connection and try again.',
        )
      })
      .finally(() => setIsLoading(false))
  }, [tripId])

  useEffect(() => { load() }, [load])

  if (isLoading) {
    return (
      // h-full, not min-h-screen: AppShell already owns the viewport-locked frame and
      // hands this page a sized, scrollable slot (see AppShell.tsx).
      <main className="flex h-full items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  if (loadError !== null || trip === null) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-sm text-surface-on-variant">
          {loadError ?? 'Trip not found.'}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
          <Button variant="ghost" size="sm" onClick={() => router.push(ROUTES.trips)}>
            Back to trips
          </Button>
        </div>
      </main>
    )
  }

  // A trip the driver hasn't started yet. 'created' is precisely that state: completing
  // the Activation phase is what flips it to 'active' server-side
  // (orchestration/phase_service.advance_activation).
  const notYetStarted = trip.status === 'created'
  // One trip at a time: another trip already underway blocks starting this one. Compared
  // by id so the trip being viewed never blocks itself.
  const otherTripUnderway =
    sessionTrip !== null &&
    sessionTrip.id !== trip.id &&
    UNDERWAY_STATUSES.includes(sessionTrip.status)

  // Point the phase flow at THIS trip before navigating into it. The step pages resolve
  // which phase_event_id to submit from TripContext, not from the URL, so without this a
  // driver opening their second assignment would submit evidence against the first.
  const openPhase = async (phase: PhaseDescriptor) => {
    if (notYetStarted && otherTripUnderway) {
      notify({
        kind: 'warning',
        title: 'Finish your active trip first',
        body: `${sessionTrip.trip_reference} is still in progress. You can only run one trip at a time.`,
      })
      return
    }
    setIsStarting(true)
    try {
      await selectTrip(String(trip.id))
      router.push(firstStepRoute(phase))
    } catch (err: unknown) {
      console.error('Failed to open the selected trip', err)
      setIsStarting(false)
      notify({
        kind: 'error',
        title: 'Could not open this trip',
        body: 'Check your connection and try again.',
      })
    }
  }

  return (
    <>
      {notYetStarted && (
        <div className="px-4 pt-4">
          <p
            className={
              otherTripUnderway
                ? 'rounded-xl bg-tertiary-container px-4 py-3 text-sm text-tertiary-on-container'
                : 'rounded-xl bg-secondary-container px-4 py-3 text-sm text-secondary-on-container'
            }
          >
            {otherTripUnderway
              ? `Finish ${sessionTrip.trip_reference} before starting this trip.`
              : 'This trip hasn’t started yet. Complete Activation below to begin it.'}
          </p>
        </div>
      )}
      {isStarting && (
        <div className="flex justify-center pt-3"><Spinner /></div>
      )}
      <TripDetailView
        trip={trip}
        onBack={() => router.push(ROUTES.trips)}
        onInTransitHub={() => router.push(ROUTES.inTransit)}
        onSelectPhase={openPhase}
        // Reached from the trips list rather than mid-journey, so the whole plan is shown
        // for context — the single-actionable-phase view lives on trips/active.
        showAllPhases
      />
    </>
  )
}
