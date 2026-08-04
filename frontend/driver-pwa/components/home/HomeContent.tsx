'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch } from 'lucide-react'
import { currentPhase, stepsFor, phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
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
    // Canonical loading state — identical markup to ActiveTripPageClient and
    // InTransitPageClient. Returning null here flashed a blank screen on every
    // cold load of Home, which reads as a crash on a slow connection.
    //
    // h-full, not min-h-screen: AppShell (the only caller) already owns the fixed,
    // locked-to-viewport frame and gives this component a sized, scrollable slot to
    // fill — a second min-h-screen here would stack on top of AppShell's own and push
    // every Home render past one screen regardless of how little content it has.
    return (
      <main className="flex h-full items-center justify-center p-6">
        <Spinner />
      </main>
    )
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
  // The in-transit leg is its own phase in the plan, not a trip.status value — the
  // coarse five (created | active | closed | cancelled | exception_hold) has no
  // 'in_transit' member. Mirrors TripDetailView's identical check, which generalises
  // across every leg of a multi-stop trip rather than just a single trip-wide state.
  const inTransit = current?.phase_type === 'in_transit'

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

      {inTransit && (
        // Mirrors TripDetailView's identical control exactly — same shortcut, same
        // shadcn Button (variant="secondary" size="lg"), so the two trip-detail
        // surfaces (Home and Trip Detail) don't hand-duplicate their own button styles.
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit)}>
          In-Transit Hub →
        </Button>
      )}

      {/* A held trip must not offer the next phase — any submit while on hold 409s.
          HoldNotice explains the pause instead. */}
      {trip.status === 'exception_hold' ? (
        <HoldNotice />
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
