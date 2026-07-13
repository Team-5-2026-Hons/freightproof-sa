// frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ShieldAlert, ScanFace } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { TripException } from '@shared/lib/types/exception'

interface ExceptionCardProps {
  exception: TripException
}

// A native <button> (not the Card component) so the expand/collapse toggle is
// keyboard-operable and announces its state via aria-expanded — long exception and
// dispatcher-note descriptions were previously clamped with no way to read the rest.
// Styling mirrors Card variant="exception".
function ExceptionCard({ exception }: ExceptionCardProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full rounded-xl border-l-4 border-error bg-surface-container-lowest p-5 text-left shadow-ambient"
    >
      <p className="text-xs font-semibold text-error-on-container capitalize">
        {exception.exception_type.replace(/_/g, ' ')}
      </p>
      {/* clamped only while collapsed — a tap reveals the full description */}
      <p className={cn('text-xs text-surface-on-variant mt-0.5', !expanded && 'line-clamp-2')}>
        {exception.description}
      </p>
    </button>
  )
}

export default function InTransitPageClient() {
  const router = useRouter()
  const { trip, isLoading, exceptions } = useTrip()

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  if (trip === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  // Read the CONTEXT exceptions list, not trip.exceptions: the context value is the
  // trip's fetched/mock exceptions plus everything logged this session (TripContext
  // appends on logException), so a just-submitted exception shows up here immediately.
  // trip.exceptions is only a fetch-time snapshot and would silently drop it.
  const openExceptions = exceptions.filter((e) => !e.resolved)

  return (
    <main className="min-h-screen flex flex-col">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="Trip detail"
        onBack={() => router.push(ROUTES.activeTripDetail)}
        right={<span className="text-xs text-surface-on-variant">In Transit</span>}
      />

      <div className="flex flex-col gap-4 p-4">
        {/* ETA */}
        <Card variant="section">
          <p className="text-xs text-surface-on-variant mb-1">Planned arrival</p>
          <p className="text-base font-semibold text-surface-on">
            {trip.planned_arrival_at
              ? new Date(trip.planned_arrival_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
              : 'Not set'}
          </p>
        </Card>

        {/* Open exceptions */}
        {openExceptions.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-error">
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            {openExceptions.map((exc) => (
              <ExceptionCard key={exc.id} exception={exc} />
            ))}
          </section>
        )}

        {/* Log checkpoint */}
        <Button
          variant="secondary"
          size="lg"
          iconLeft={<ScanFace className="h-4 w-4" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.checkpoint)}
        >
          Log checkpoint
        </Button>

        {/* Log exception */}
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(ROUTES.exception)}
        >
          Log exception
        </Button>

        {/* Begin destination gate-in */}
        <Button
          size="lg"
          iconRight={<ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.handshakeStep(4, STEP_SLUGS[4][0]))}
        >
          Arrive at destination
        </Button>

        {/* Panic */}
        <Button
          variant="danger"
          size="lg"
          className="mt-2"
          iconLeft={<ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.panic)}
        >
          Panic
        </Button>
      </div>
    </main>
  )
}
