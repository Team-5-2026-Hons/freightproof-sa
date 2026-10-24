'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { TripDetailView } from '@/components/trip/TripDetailView'
import { useBack } from '@/lib/navigation/useBack'

// Route to the first step of the selected phase's own recipe.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves before the
  // driver is ever involved.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
}

export default function TripDetailPageClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // Back to where the driver came from (Home or Trips); Trips on a cold start.
  const goBack = useBack(ROUTES.trips)
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  return (
    <TripDetailView
      trip={trip}
      onBack={goBack}
      onInTransitHub={() => router.push(ROUTES.inTransit)}
      onSelectPhase={(phase) => router.push(firstStepRoute(phase))}
      // Collapsed like the live route: the demo opens trips here, and a
      // full list up front pushed Route below the fold. "All steps" reveals it.
      showAllPhases={false}
    />
  )
}
