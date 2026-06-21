// frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function ActiveTripPageClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2 backend: fetch from GET /driver/trips/{id}
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-surface-on-variant text-sm">Trip not found.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <button onClick={() => router.push(ROUTES.trips)} className="mb-4 text-sm text-secondary">
        ← My Trips
      </button>
      <h1 className="text-xl font-semibold">{trip.trip_reference}</h1>
      <p className="mb-4 text-sm text-surface-on-variant">{trip.order_number}</p>

      <section className="mb-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <p className="mb-1 text-sm font-medium">Status</p>
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs">{trip.status}</span>
      </section>

      {trip.status === 'in_transit' && (
        <button
          className="mb-4 w-full rounded-xl border border-secondary bg-secondary/5 p-3 text-left text-sm font-medium text-secondary"
          onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}
        >
          In-Transit Hub →
        </button>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Handshakes</h2>
        <ul className="flex flex-col gap-2">
          {HANDSHAKE_NUMBERS.map((n) => (
            <li key={n}>
              <button
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-left text-sm"
                onClick={() =>
                  router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))
                }
              >
                <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
