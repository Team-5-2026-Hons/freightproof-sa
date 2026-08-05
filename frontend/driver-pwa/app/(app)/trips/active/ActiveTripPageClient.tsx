// frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx
'use client'

import { useRouter } from 'next/navigation'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { TripDetailView } from '@/components/trip/TripDetailView'

// Route to the first step of the selected phase's own recipe. Mirrors
// PhaseStepPageClient.tsx's local currentStepRoute — lib/phase/ itself stays the
// only export surface for sequencing, this is just route composition, kept local to
// each caller the same way that file keeps its own.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
}

export default function ActiveTripPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  if (isLoading) {
    return <LoadingScreen label="Loading trip" />
  }

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
      // The real, session-derived trip shows only the single current phase
      // (docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md,
      // unchanged design intent under the phase model).
      showAllPhases={false}
    />
  )
}
