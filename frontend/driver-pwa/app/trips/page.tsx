'use client'

import { useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'

export default function TripsPage() {
  const router = useRouter()
  // TODO Iter 2: replace with GET /driver/trips using authenticated session.
  // mockTrips is typed Trip[] in the shared lib (not TripSummary[]).
  const trips: Trip[] = mockTrips

  if (trips.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-gray-500">No active trips assigned to you.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-4">My Trips</h1>
      <ul className="flex flex-col gap-3">
        {trips.map((trip) => (
          <li key={trip.id}>
            <button
              className="w-full text-left rounded-xl border border-gray-200 p-4 bg-white shadow-sm"
              onClick={() => router.push(`/trips/${trip.id}`)}
            >
              <p className="font-medium">{trip.trip_reference}</p>
              <p className="text-sm text-gray-500">{trip.order_number}</p>
              <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                {trip.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
