'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch } from 'lucide-react'
import { stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { NowCard } from '@/components/home/NowCard'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// Route to the first step of the current phase's own recipe. Mirrors
// PhaseStepPageClient.tsx's local currentStepRoute — lib/phase/ itself stays the
// only export surface for sequencing, this is just route composition, kept local to
// each caller the same way that file keeps its own.
function firstStepRoute(phase: PhaseDescriptor): string {
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves before the
  // driver is ever involved — currentPhase should never surface it as "current" here.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
}

export function HomeContent() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  if (isLoading) {
    // Canonical loading state — the one LoadingScreen component every waiting screen in
    // the app now renders. Returning null here flashed a blank screen on every cold load
    // of Home, which reads as a crash on a slow connection.
    return <LoadingScreen label="Loading your trip" />
  }

  if (!trip) {
    return (
      <main className="flex h-full flex-col gap-4 p-4">
        <EmptyState
          icon={<PackageSearch strokeWidth={1.5} aria-hidden />}
          title="No active trip right now"
          body="Your dispatcher hasn’t assigned you a trip yet."
        />
      </main>
    )
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      {/* Hold, driving and next-phase rules live in NowCard — see its header comment. */}
      <NowCard
        trip={trip}
        onStartPhase={(phase) => router.push(firstStepRoute(phase))}
        onContinueDriving={() => router.push(ROUTES.inTransit)}
        onViewTrip={() => router.push(ROUTES.activeTripDetail)}
      />
    </main>
  )
}
