'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch } from 'lucide-react'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
import { CurrentHandshakeCard } from '@/components/trip/CurrentHandshakeCard'
import { HoldNotice } from '@/components/trip/HoldNotice'

export function HomeContent() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  if (isLoading) {
    // Canonical loading state — identical markup to ActiveTripPageClient and
    // InTransitPageClient. Returning null here flashed a blank screen on every
    // cold load of Home, which reads as a crash on a slow connection.
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  if (!trip) {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-4">
        <EmptyState
          icon={<PackageSearch strokeWidth={1.5} aria-hidden />}
          title="No active trip right now"
          body="Your dispatcher hasn’t assigned you a trip yet."
        />
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)
  const progress = handshakeProgress(trip.handshakes)
  const current = currentHandshakeNumber(progress)

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div>
        <p className="text-xl font-semibold text-surface-on">{trip.trip_reference}</p>
        <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
      </div>

      <Chip kind={kind} className="self-start">{label}</Chip>

      <HandshakeProgressBar progress={progress} />

      {trip.status === 'in_transit' && (
        // Mirrors TripDetailView's identical control exactly — same shortcut, same
        // shadcn Button (variant="secondary" size="lg"), so the two trip-detail
        // surfaces (Home and Trip Detail) don't hand-duplicate their own button styles.
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit)}>
          In-Transit Hub →
        </Button>
      )}

      {/* A held trip (H4 seal mismatch) must not offer the next handshake — any
          submit while on hold 409s. HoldNotice explains the pause instead. */}
      {trip.status === 'exception_hold' ? (
        <HoldNotice />
      ) : (
        current !== null && (
          <CurrentHandshakeCard
            handshakeNumber={current}
            onSelect={() => router.push(ROUTES.handshakeStep(current, STEP_SLUGS[current][0]))}
          />
        )
      )}
    </main>
  )
}
