// frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function ActiveTripPageClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2 backend: fetch from GET /driver/trips/{id}
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)

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

      <HandshakeProgressBar progress={handshakeProgress(trip.handshakes)} />

      {trip.status === 'in_transit' && (
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}>
          In-Transit Hub →
        </Button>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {HANDSHAKE_NUMBERS.map((n) => (
          <Card
            key={n}
            variant="dark"
            onClick={() => router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))}
          >
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Card>
        ))}
      </section>
    </main>
  )
}
