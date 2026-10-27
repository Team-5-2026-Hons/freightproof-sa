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

const TRIP_ERROR_TITLE = 'Trip'

function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.trips
}

export default function TripDetailByIdPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.trips)
  const searchParams = useSearchParams()
  const tripId = searchParams.get(TRIP_ID_PARAM)
  const { notify } = useToast()
  const { selectTrip, trip: workingTrip, noteTripHandedOver } = useTrip()
  const driverId = useContext(AuthContext)?.user?.id

  const [trip, setTrip] = useState<Trip | null>(null)
  const [history, setHistory] = useState<DriverParticipationHistoryRead | null>(null)
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
    fetchMyTrips()
      .then(setSiblings)
      .catch((err: unknown) => console.error('Could not load sibling trips for the activation gate', err))
    fetchMyTrip(tripId)
      .then(setTrip)
      .catch(async (err: unknown) => {
        if (isTripHandedOver(err)) {
          try {
            setHistory(await fetchDriverParticipation(tripId))
          } catch (historyErr: unknown) {
            console.error('Failed to load participation history', historyErr)
            setLoadError('You handed this trip over. Your record could not be loaded. Check your connection and try again.')
          }
          return
        }
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

  const workingTripId = workingTrip ? String(workingTrip.id) : null
  useEffect(() => {
    if (history !== null && workingTripId === history.trip_id) noteTripHandedOver(history.trip_id)
  }, [history, workingTripId, noteTripHandedOver])

  if (isLoading) {
    return <LoadingScreen label="Loading trip" />
  }

  if (history !== null) {
    return <DriverParticipationHistory history={history} onBack={goBack} />
  }

  if (loadError !== null || trip === null) {
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

  const notYetStarted = trip.status === 'created'
  const block = activationBlock(trip, siblings, new Date())

  const openPhase = async (phase: PhaseDescriptor) => {
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
      showAllPhases={false}
    />
  )
}
