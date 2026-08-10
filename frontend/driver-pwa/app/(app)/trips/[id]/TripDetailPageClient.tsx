// frontend/driver-pwa/app/(app)/trips/[id]/TripDetailPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { TripDetailView } from '@/components/trip/TripDetailView'

// Route to the first step of the selected phase's own recipe. Mirrors
// PhaseStepPageClient.tsx's local currentStepRoute — lib/phase/ itself stays the
// only export surface for sequencing, this is just route composition, kept local to
// each caller the same way that file keeps its own.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves before the
  // driver is ever involved — TripDetailView only ever offers this callback for the
  // current phase, which should never be trip_creation by the time a driver sees it.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
}

export default function TripDetailPageClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2 backend: fetch from GET /driver/trips/{id}
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
      onBack={() => router.push(ROUTES.trips)}
      onInTransitHub={() => router.push(ROUTES.inTransit)}
      onSelectPhase={(phase) => router.push(firstStepRoute(phase))}
      // This mock trip-detail screen still lists every phase in the plan for context —
      // mirrors trips/active/ActiveTripPageClient.tsx's single-actionable-phase model
      // for the *current* one, but shows the full set since there's no live progress
      // feed backing it yet.
      showAllPhases
    />
  )
}
