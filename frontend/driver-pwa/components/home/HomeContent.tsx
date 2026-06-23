'use client'

import { useRouter } from 'next/navigation'
import { PackageSearch } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { tripsForDriver, categorizeTrips } from '@/lib/utils/trip-filters'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export function HomeContent() {
  const router = useRouter()
  const { user } = useAuth()

  if (!user) return null

  // TODO Iter 2 backend: replace with GET /driver/trips using authenticated session
  const driverTrips = tripsForDriver(mockTrips, user.id)
  const { active, upcoming } = categorizeTrips(driverTrips)
  const trip = active[0]

  if (!trip) {
    const next = upcoming[0]
    return (
      <main className="flex min-h-screen flex-col gap-4 p-4">
        <EmptyState
          icon={<PackageSearch strokeWidth={1.5} aria-hidden />}
          title="No active trip right now"
          body={next ? 'Your next trip is below.' : 'Your dispatcher hasn’t assigned you a trip yet.'}
        />
        {next && (
          <Card variant="section" onClick={() => router.push(ROUTES.tripDetail(String(next.id)))}>
            <p className="text-xs uppercase tracking-wider text-surface-on-variant">Next up</p>
            <p className="mt-1 font-semibold text-surface-on">{next.trip_reference}</p>
          </Card>
        )}
      </main>
    )
  }

  const { kind, label } = tripStatusChip(trip.status)

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div>
        <p className="text-xl font-semibold text-surface-on">{trip.trip_reference}</p>
        <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
      </div>

      <Chip kind={kind} className="self-start">{label}</Chip>

      <HandshakeProgressBar progress={handshakeProgress(trip.handshakes)} />

      {trip.status === 'in_transit' && (
        <button
          className="w-full rounded-xl border border-secondary bg-secondary/5 p-3 text-left text-sm font-medium text-secondary"
          onClick={() => router.push(ROUTES.inTransit(String(trip.id)))}
        >
          In-Transit Hub →
        </button>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {HANDSHAKE_NUMBERS.map((n) => (
          <Button
            key={n}
            variant="primary"
            size="lg"
            className="justify-start"
            onClick={() => router.push(ROUTES.handshakeStep(String(trip.id), n, STEP_SLUGS[n][0]))}
          >
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Button>
        ))}
      </section>
    </main>
  )
}
