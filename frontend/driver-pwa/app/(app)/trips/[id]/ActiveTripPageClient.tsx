// frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { mockTrips } from '@shared/lib/mocks/trips'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { TripDetailView } from '@/components/trip/TripDetailView'

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

  return (
    <TripDetailView
      trip={trip}
      onBack={() => router.push(ROUTES.trips)}
      onInTransitHub={() => router.push(ROUTES.inTransit)}
      onSelectHandshake={(n) => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0]))}
      // This mock trip-detail screen still lists all five handshakes for context —
      // mirrors trips/active/ActiveTripPageClient.tsx's single-actionable-handshake
      // model for the *current* one, but shows the full set since there's no live
      // progress feed backing it yet.
      showAllHandshakes
    />
  )
}
