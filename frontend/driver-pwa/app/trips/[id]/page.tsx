'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'

// H1–H5 are the driver-facing handshakes (H0 is dispatcher-only). STEP_SLUGS is a
// Record keyed by handshake number; STEP_SLUGS[n][0] is that handshake's first step slug.
const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export default function ActiveTripPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // TODO Iter 2: fetch from GET /driver/trips/{id}
  // TripId is a branded string; casting the route param allows find() to match by value.
  const trip = mockTrips.find((t) => (t.id as string) === id)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-gray-500">Trip not found.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <button onClick={() => router.back()} className="mb-4 text-sm text-blue-600">← Back</button>
      <h1 className="text-xl font-semibold">{trip.trip_reference}</h1>
      <p className="text-sm text-gray-500 mb-4">{trip.order_number}</p>

      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-1 text-sm font-medium">Status</p>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{trip.status}</span>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Handshakes</h2>
        <ul className="flex flex-col gap-2">
          {HANDSHAKE_NUMBERS.map((n) => (
            <li key={n}>
              <button
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left text-sm"
                onClick={() => router.push(`/trips/${id}/handshake/${STEP_SLUGS[n][0]}`)}
              >
                <span className="font-medium">H{n}:</span> {HANDSHAKE_NAMES[n]}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
