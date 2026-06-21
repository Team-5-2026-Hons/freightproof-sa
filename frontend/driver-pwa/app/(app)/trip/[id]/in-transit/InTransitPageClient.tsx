// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/InTransitPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, ShieldAlert } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { Button } from '@/components/ui/Button'

export default function InTransitPageClient() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const trip = mockTrips.find((t) => (t.id as string) === tripId)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  const openExceptions = trip.exceptions.filter((e) => !e.resolved)

  return (
    <main className="min-h-screen flex flex-col">
      <header className="sticky top-0 bg-surface shadow-ambient-header px-4 py-4">
        <button onClick={() => router.push(ROUTES.tripDetail(tripId))} className="mb-1 text-sm text-secondary">
          ← Trip detail
        </button>
        <h1 className="text-xl font-bold">{trip.trip_reference}</h1>
        <p className="text-sm text-surface-on-variant">In Transit</p>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {/* ETA */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Planned arrival</p>
          <p className="text-base font-semibold">
            {trip.planned_arrival_at
              ? new Date(trip.planned_arrival_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
              : 'Not set'}
          </p>
        </section>

        {/* Open exceptions */}
        {openExceptions.length > 0 && (
          <section>
            <p className="mb-2 text-sm font-semibold text-error">
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            <ul className="flex flex-col gap-2">
              {openExceptions.map((exc) => (
                <li key={exc.id} className="rounded-xl bg-error-container/50 px-4 py-3">
                  <p className="text-xs font-semibold text-error-on-container capitalize">
                    {exc.exception_type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-surface-on-variant mt-0.5 line-clamp-2">{exc.description}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Log exception */}
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(ROUTES.exception(tripId))}
        >
          Log exception
        </Button>

        {/* Begin destination gate-in */}
        <Button
          size="lg"
          iconRight={<ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.handshakeStep(tripId, 4, STEP_SLUGS[4][0]))}
        >
          Arrive at destination
        </Button>

        {/* Panic */}
        <button
          onClick={() => router.push(ROUTES.panic(tripId))}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-error py-4 text-sm font-bold uppercase tracking-widest text-error-on"
        >
          <ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />
          Panic
        </button>
      </div>
    </main>
  )
}
