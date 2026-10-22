// Detail for one of the driver's own trips, addressed by ?id=<uuid>. Distinct from
// trips/active: this screen can open a trip the driver has not activated yet.
'use client'

import { useCallback, useContext, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import type { DriverParticipationHistoryRead } from '@shared/lib/types/driver-substitution'
import { fetchMyTrip, fetchMyTrips } from '@/lib/api/trips'
import { fetchDriverParticipation, isTripHandedOver } from '@/lib/api/driver-substitutions'
import { ApiError } from '@/lib/api/client'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES, TRIP_ID_PARAM } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { TruckLoader } from '@/components/ui/TruckLoader'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { TripDetailView } from '@/components/trip/TripDetailView'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { DriverParticipationHistory } from '@/components/trip/DriverParticipationHistory'
import { DriverSubstitutionCard } from '@/components/trip/DriverSubstitutionCard'
import { AuthContext } from '@/lib/context/AuthContext'
import { substitutionRoleFor } from '@/lib/utils/driver-substitution'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { activationBlock, activationBlockMessage } from '@/lib/utils/activation-gate'
import type { ActivationCandidate } from '@/lib/utils/activation-gate'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useBack } from '@/lib/navigation/useBack'

// The header title while there is no trip to name — the loaded states title themselves
// "Current trip" / "Upcoming trip" / "Trip record" from the trip's status, which a failed
// load does not have.
const TRIP_ERROR_TITLE = 'Trip'

// Route to the first step of the selected phase's own recipe.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves before the
  // driver is ever involved.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.trips
}

export default function TripDetailByIdPageClient() {
  const router = useRouter()
  // Back to where the driver came from (Home or Trips); Trips on a cold start.
  const goBack = useBack(ROUTES.trips)
  const searchParams = useSearchParams()
  const tripId = searchParams.get(TRIP_ID_PARAM)
  const { notify } = useToast()
  const { selectTrip, trip: workingTrip, noteTripHandedOver } = useTrip()
  // Read directly rather than through useAuth: only needed to place this driver in a pending
  // handover, and the page's existing test harnesses render without an AuthProvider.
  const driverId = useContext(AuthContext)?.user?.id

  const [trip, setTrip] = useState<Trip | null>(null)
  // Set instead of `trip` when the server says this driver handed the trip over: they see
  // their own restricted record, never the current driver's live detail.
  const [history, setHistory] = useState<DriverParticipationHistoryRead | null>(null)
  // The driver's other trips, needed to answer "may this one be started yet". Read from
  // the list endpoint since TripContext only holds whichever single trip is current.
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
    setHistory(null)
    // The sibling list is best-effort: its own failure must not stop the trip itself
    // rendering, because the server enforces every one of these rules regardless. A
    // failed list only costs the driver an up-front explanation, not correctness.
    fetchMyTrips()
      .then(setSiblings)
      .catch((err: unknown) => console.error('Could not load sibling trips for the activation gate', err))
    fetchMyTrip(tripId)
      .then(setTrip)
      .catch(async (err: unknown) => {
        if (isTripHandedOver(err)) {
          // Reading the history must not make the trip working context again — this page
          // never calls selectTrip on this path.
          try {
            setHistory(await fetchDriverParticipation(tripId))
          } catch (historyErr: unknown) {
            console.error('Failed to load participation history', historyErr)
            setLoadError('You handed this trip over. Your record could not be loaded — check your connection and try again.')
          }
          return
        }
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

  // The server just told us this driver no longer holds the trip. If it is also the trip the
  // phase flow is pointed at, drop it there too, so Home stops offering its live actions.
  const workingTripId = workingTrip ? String(workingTrip.id) : null
  useEffect(() => {
    if (history !== null && workingTripId === history.trip_id) noteTripHandedOver(history.trip_id)
  }, [history, workingTripId, noteTripHandedOver])

  if (isLoading) {
    // Centred on the viewport rather than on AppShell's slot, which reserves bottom
    // padding for the nav pill and so pulled the old indicator above the middle of the
    // screen — see LoadingScreen.tsx.
    return <LoadingScreen label="Loading trip" />
  }

  if (history !== null) {
    return <DriverParticipationHistory history={history} onBack={goBack} />
  }

  if (loadError !== null || trip === null) {
    // The same TabSubpage the loaded trip renders in, so a failed load keeps the header,
    // the back control and the tab bar. The bare <main className="h-full …"> this replaces
    // had no height to centre in (its parent is auto-height), so the message hugged the top
    // edge with no way back except the button below it. flex-1 fills TabSubpage's column.
    return (
      <TabSubpage title={TRIP_ERROR_TITLE} backLabel="Trips" onBack={goBack}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <p className="text-center text-sm text-surface-on-variant">
            {loadError ?? 'Trip not found.'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={load}>Try Again</Button>
            <Button variant="secondary" size="sm" onClick={() => { markTransition('back'); router.push(ROUTES.trips) }}>
              Back to Trips
            </Button>
          </div>
        </div>
      </TabSubpage>
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
  // The upcoming page already says when the trip starts and where; the notice is only
  // for what it can't know — the activation gate refusing this trip — and the brief
  // "Starting trip" moment after Start is tapped.
  // A handover arranged on this trip is shown on the trip itself, with the link
  // to this driver's own check. The role comes from the arrangement, never from this screen.
  const pendingSubstitution = trip.pending_driver_substitution ?? null
  const substitutionRole = pendingSubstitution !== null && driverId !== undefined
    ? substitutionRoleFor(pendingSubstitution, String(driverId))
    : null
  const substitutionCard = pendingSubstitution !== null && substitutionRole !== null
    ? <DriverSubstitutionCard request={pendingSubstitution} role={substitutionRole} />
    : null

  const notice = (block !== null && notYetStarted) || isStarting || substitutionCard !== null ? (
    <div className="flex flex-col gap-3">
      {substitutionCard}
      {block !== null && notYetStarted && (
        <StatusBanner tone="attention" title="Can’t start this trip yet">{activationBlockMessage(block)}</StatusBanner>
      )}
      {/* sm: this one shares the notice block with the gate message above it, so it
          can't take a full screen's worth of truck. */}
      {isStarting && <TruckLoader size="sm" label="Starting trip" className="self-center" />}
    </div>
  ) : undefined

  return (
    <TripDetailView
      trip={trip}
      onBack={goBack}
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
