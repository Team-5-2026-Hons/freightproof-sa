// frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx
'use client'

import { useRouter } from 'next/navigation'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress, visibleHandshakeNumbers } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'

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
  const visibleHandshakes = visibleHandshakeNumbers(progress)

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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {visibleHandshakes.map((n) => (
          <Card
            key={n}
            variant="dark"
            onClick={() => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0]))}
          >
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Card>
        ))}
      </section>
    </main>
  )
}
