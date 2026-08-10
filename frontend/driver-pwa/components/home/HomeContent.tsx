'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch, Truck } from 'lucide-react'
import { currentPhase, isDriving, stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { PhaseProgressBar } from '@/components/trip/PhaseProgressBar'
import { CurrentPhaseCard } from '@/components/trip/CurrentPhaseCard'
import { HoldNotice } from '@/components/trip/HoldNotice'
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

  const { kind, label } = tripStatusChip(trip.status)
  const current = currentPhase(trip.phases)
  // isDriving is true only while the ledger's current row is an unresolved in_transit —
  // i.e. between departure and the driver's own arrival submission. Works the same on
  // single-stop and cross-dock plans.
  const driving = isDriving(trip.phases)

  return (
    <main className="flex flex-col gap-4 p-4">
      {/* Reference and status on one row — same arrangement as a trips-list TripCard,
          so the card a driver taps and the screen it opens read as the same object.
          The chip previously sat on its own line below, which cost a full row of
          vertical space and left the reference block looking orphaned. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-surface-on">{trip.trip_reference}</p>
          <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
        </div>
        <Chip kind={kind} className="mt-0.5 shrink-0">{label}</Chip>
      </div>

      <PhaseProgressBar phases={trip.phases} />

      {/* A held trip must not offer the next phase — any submit while on hold 409s.
          HoldNotice explains the pause instead, and that outranks the driving screen too:
          a driver on hold has been told to stop, not to keep going. */}
      {trip.status === 'exception_hold' ? (
        <HoldNotice />
      ) : driving ? (
        // While driving, the driving screen IS the primary action — not the arrival
        // phase's capture card. Offering "Unloading" to a driver doing 100 km/h on the N3
        // asks them to start an evidence step they cannot complete for another two hours;
        // the map, panic and exception logging are what they actually need in that window.
        // The arrival step is one tap away from there ("Arrive at destination").
        <Button
          size="lg"
          iconLeft={<Truck className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.inTransit)}
        >
          Continue driving
        </Button>
      ) : (
        current !== null && (
          <CurrentPhaseCard
            phase={current}
            onSelect={() => router.push(firstStepRoute(current))}
          />
        )
      )}
    </main>
  )
}
