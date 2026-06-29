// frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx
'use client'

import { useRouter } from 'next/navigation'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
import { CurrentHandshakeCard } from '@/components/trip/CurrentHandshakeCard'

export default function ActiveTripPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)
  const progress = handshakeProgress(trip.handshakes)
  const current = currentHandshakeNumber(progress)

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <button onClick={() => router.push(ROUTES.trips)} className="self-start text-sm text-secondary">
        ← My Trips
      </button>

      <div>
        <h1 className="text-xl font-semibold text-surface-on">{trip.trip_reference}</h1>
        <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
      </div>

      <Card variant="section">
        <p className="mb-2 text-sm font-medium text-surface-on">Status</p>
        <Chip kind={kind}>{label}</Chip>
      </Card>

      <HandshakeProgressBar progress={progress} />

      {trip.status === 'in_transit' && (
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit)}>
          In-Transit Hub →
        </Button>
      )}

      {current !== null && (
        <CurrentHandshakeCard
          handshakeNumber={current}
          onSelect={() => router.push(ROUTES.handshakeStep(current, STEP_SLUGS[current][0]))}
        />
      )}
    </main>
  )
}
