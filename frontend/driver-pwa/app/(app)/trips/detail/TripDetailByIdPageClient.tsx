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
import { fetchMyTrip, fetchMyTrips } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES, TRIP_ID_PARAM } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { TruckLoader } from '@/components/ui/TruckLoader'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { TripDetailView } from '@/components/trip/TripDetailView'
import { activationBlock, activationBlockMessage } from '@/lib/utils/activation-gate'
import type { ActivationCandidate } from '@/lib/utils/activation-gate'

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
  const { selectTrip } = useTrip()

  const [trip, setTrip] = useState<Trip | null>(null)
  // The driver's OTHER trips, needed to answer "may this one be started yet" — a trip
  // already underway, or an earlier trip due the same day, both block activation. Read
  // from the list endpoint rather than TripContext: the context holds only whichever
  // single trip the server calls current, which cannot see a same-day sibling at all.
  const [siblings, setSiblings] = useState<ActivationCandidate[]>([])
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
    // The sibling list is best-effort: its own failure must not stop the trip itself
    // rendering, because the server enforces every one of these rules regardless. A
    // failed list only costs the driver an up-front explanation, not correctness.
    fetchMyTrips()
      .then(setSiblings)
      .catch((err: unknown) => console.error('Could not load sibling trips for the activation gate', err))
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
    // Centred on the viewport rather than on AppShell's slot, which reserves bottom
    // padding for the nav pill and so pulled the old indicator above the middle of the
    // screen — see LoadingScreen.tsx.
    return <LoadingScreen label="Loading trip" />
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
  // Every reason this trip can't be started yet, in the same order the server checks
  // them (lib/utils/activation-gate.ts mirrors phase_service). null means it's startable.
  const block = activationBlock(trip, siblings, new Date())

  // Point the phase flow at THIS trip before navigating into it. The step pages resolve
  // which phase_event_id to submit from TripContext, not from the URL, so without this a
  // driver opening their second assignment would submit evidence against the first.
  const openPhase = async (phase: PhaseDescriptor) => {
    // Refuse here rather than letting the driver capture a full step's evidence and be
    // rejected by the server's 409 at submit time.
    if (block !== null) {
      notify({ kind: 'warning', title: 'Can’t start this trip yet', body: activationBlockMessage(block) })
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

  // Both of these go through TripDetailView's `notice` slot rather than being rendered
  // as siblings above it. They used to sit outside its <main>, which on this full-bleed
  // route meant they painted under the iOS status bar and pushed a viewport-tall screen
  // off the bottom of the display — see TripDetailViewProps.notice for the full reason.
  const notice = (notYetStarted || isStarting) ? (
    <div className="flex flex-col gap-3">
      {notYetStarted && (
        <p
          className={
            block !== null
              ? 'rounded-xl bg-tertiary-container px-4 py-3 text-sm text-tertiary-on-container'
              : 'rounded-xl bg-secondary-container px-4 py-3 text-sm text-secondary-on-container'
          }
        >
          {block !== null
            ? activationBlockMessage(block)
            : 'This trip hasn’t started yet. Complete Activation below to begin it.'}
        </p>
      )}
      {/* sm: this one shares the notice block with the activation copy above it, so it
          can't take a full screen's worth of truck. */}
      {isStarting && <TruckLoader size="sm" label="Starting trip" className="self-center" />}
    </div>
  ) : undefined

  return (
    <TripDetailView
      trip={trip}
      onBack={() => router.push(ROUTES.trips)}
      onInTransitHub={() => router.push(ROUTES.inTransit)}
      onSelectPhase={openPhase}
      notice={notice}
      // Single actionable phase only, identical to trips/active. The full plan listing
      // stays on trips/[id] (the mock/demo route) — on a real trip it filled the screen
      // with rows the driver cannot act on and pushed the one card that IS actionable
      // below the fold.
      showAllPhases={false}
    />
  )
}
