// frontend/driver-pwa/app/(app)/trips/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { ROUTES } from '@/lib/constants/routes'

export default function TripsPage() {
  const router = useRouter()
  // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
  const trips: Trip[] = mockTrips

  if (trips.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-surface-on-variant text-sm">No active trips assigned to you.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <h1 className="mb-4 text-xl font-semibold">My Trips</h1>
      <ul className="flex flex-col gap-3">
        {trips.map((trip) => (
          <li key={trip.id}>
            <button
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-left shadow-ambient-sm"
              onClick={() => router.push(ROUTES.tripDetail(String(trip.id)))}
            >
              <p className="font-semibold">{trip.trip_reference}</p>
              <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
              <span className="mt-1 inline-block rounded-full bg-surface-container-high px-2 py-0.5 text-xs">
                {trip.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
