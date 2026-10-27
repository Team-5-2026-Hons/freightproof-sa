'use client'

import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { NowCard } from '@/components/home/NowCard'
import { openDriverExceptions } from '@/lib/utils/trip-attention'
import { DriverRecord } from '@/components/home/DriverRecord'
import { DriverSubstitutionPanel } from '@/components/trip/DriverSubstitutionPanel'
import { TripEndedByDispatchBanner } from '@/components/trip/TripEndedByDispatchBanner'
import { useAuth } from '@/lib/hooks/useAuth'
import { useMyTrips } from '@/lib/hooks/useMyTrips'
import { driverRecord } from '@/lib/utils/driver-record'
import { firstName, partOfDayGreeting } from '@/lib/utils/greeting'
import { formatLongDate } from '@/lib/utils/format-time'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
}

export function HomeContent() {
  const router = useRouter()
  const { trip, isLoading, exceptions } = useTrip()
  const { user } = useAuth()
  const { trips, isLoading: tripsLoading, loadError: tripsError } = useMyTrips()

  if (isLoading) {
    return <LoadingScreen label="Loading your trip" />
  }

  const name = user ? firstName(user.full_name) : null
  const header = (
    <div>
      <p className="text-subhead text-surface-on-variant">{formatLongDate(new Date())}</p>
      <p className="text-title-1 tracking-tight text-surface-on">
        {partOfDayGreeting(new Date())}{name ? `, ${name}` : ''}
      </p>
    </div>
  )
  const record = !tripsLoading && tripsError === null ? <DriverRecord record={driverRecord(trips)} /> : null

  if (!trip) {
    return (
      <main className="flex flex-col gap-5 px-4 pb-4 pt-1">
        {header}
        <TripEndedByDispatchBanner />
        <DriverSubstitutionPanel />
        <section aria-label="No trip" className="flex flex-col items-center rounded-[22px] bg-fill px-6 pb-6 pt-7 text-center">
          <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-surface">
            <Truck className="size-8 text-surface-on" strokeWidth={1.7} />
          </span>
          <p className="mt-4 text-title-2 text-surface-on">No trip assigned</p>
          <p className="mt-1.5 max-w-[290px] text-subhead text-surface-on-variant">
            Your dispatcher assigns trips. The next one appears here the moment it’s ready.
          </p>
          <button
            type="button"
            onClick={() => router.push(ROUTES.tripsPast)}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-surface px-5 text-subhead font-semibold text-surface-on transition-transform duration-100 active:scale-95"
          >
            See past trips
          </button>
        </section>
        {record}
      </main>
    )
  }

  return (
    <main className="flex flex-col gap-5 px-4 pb-4 pt-1">
      {header}
      <TripEndedByDispatchBanner />
      <DriverSubstitutionPanel />
      <NowCard
        trip={trip}
        exceptions={openDriverExceptions(exceptions)}
        onStartPhase={(phase) => router.push(firstStepRoute(phase))}
        onContinueDriving={() => router.push(ROUTES.inTransit)}
        onViewTrip={() => router.push(ROUTES.activeTripDetail)}
      />
      {record}
    </main>
  )
}
