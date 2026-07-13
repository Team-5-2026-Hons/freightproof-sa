// frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx
'use client'

import { useRouter } from 'next/navigation'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { Spinner } from '@/components/ui/Spinner'
import { TripDetailView } from '@/components/trip/TripDetailView'

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

  return (
    <TripDetailView
      trip={trip}
      onBack={() => router.push(ROUTES.trips)}
      onInTransitHub={() => router.push(ROUTES.inTransit)}
      onSelectHandshake={(n) => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0]))}
      // The real, session-derived trip shows only the single current handshake
      // (docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md).
      showAllHandshakes={false}
    />
  )
}
