// frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
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
  const progress = handshakeProgress(trip.handshakes)
  const current = currentHandshakeNumber(progress)

  return (
    <main className="flex min-h-screen flex-col">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="My Trips"
        onBack={() => router.push(ROUTES.trips)}
        right={<span className="text-xs text-surface-on-variant">{trip.order_number}</span>}
      />

      <div className="flex flex-col gap-4 p-4">
        <Card variant="section">
          <p className="mb-2 text-sm font-medium text-surface-on">Status</p>
          <Chip kind={kind}>{label}</Chip>
        </Card>

        <HandshakeProgressBar progress={handshakeProgress(trip.handshakes)} />

        {trip.status === 'in_transit' && (
          <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.inTransit)}>
            In-Transit Hub →
          </Button>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
          {/* Only the current handshake (docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md)
              is tappable — a completed one is done and re-entering it would resubmit
              already-anchored evidence; a future one hasn't unlocked yet. Mirrors
              trips/active/ActiveTripPageClient.tsx's single-actionable-handshake model,
              but this mock trip-detail screen still lists all five for context. */}
          {HANDSHAKE_NUMBERS.map((n) => {
            const isCurrent = n === current
            const isCompleted = progress[n] === 'completed'

            return (
              <Card
                key={n}
                variant={isCurrent ? 'dark' : isCompleted ? 'default' : 'section'}
                onClick={isCurrent ? () => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0])) : undefined}
                className={!isCurrent && !isCompleted ? 'opacity-50' : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
                  </span>
                  {isCompleted && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />}
                </div>
              </Card>
            )
          })}
        </section>
      </div>
    </main>
  )
}
