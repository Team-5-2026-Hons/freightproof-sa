// frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx
'use client'

// The driving screen — the part of the trip where the driver is actually moving.
//
// It exists as a hub, not an evidence capture: `in_transit` has no step recipe and the
// backend auto-completes it the moment `departure` advances, so there is nothing here to
// submit. What a driver needs while moving is a map, a panic button they never have to
// look for, and a short list of things they might have to log. That is the whole screen.
//
// Reachability: this used to be unreachable on a real trip, because both entry points
// tested `currentPhase().phase_type === 'in_transit'` — a state the driver can never
// observe. They now test `isDriving()` (lib/phase/derive.ts), which reads the driving leg
// off the SHAPE of the plan instead of off a status.
//
// Layout invariant: PANIC IS NEVER BEHIND A SCROLL. The action stack at the bottom is
// `shrink-0` inside an `overflow-hidden` viewport-height column, and the only part of it
// that can grow (the open-exceptions list) is height-capped and scrolls inside itself. The
// map takes whatever is left, which on any phone is the largest element on screen.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ShieldAlert, ScanFace, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { currentPhase, stepsFor, phaseStepRoute } from '@/lib/phase'
import { Button } from '@/components/ui/Button'
import { DriverMap } from '@/components/map/DriverMap'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { DriverPosition } from '@/lib/types/location'
import type { TripException } from '@shared/lib/types/exception'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// How often the map re-reads the phone's position while this screen is open. A truck at
// 100 km/h covers ~400 m in this window, which at street zoom is about a screen height —
// often enough to read as "following", rare enough not to hold the GPS radio awake.
const POSITION_REFRESH_MS = 15_000

// Cap on the open-exceptions list before it scrolls inside itself. This is what keeps the
// panic button on screen no matter how many exceptions a bad leg has accumulated.
const EXCEPTION_LIST_MAX_HEIGHT = 'max-h-36'

interface ExceptionCardProps {
  exception: TripException
}

interface DriverFix {
  position: DriverPosition
  /** When this fix was taken, so a stale one can be labelled as last known. */
  capturedAt: string
}

// The route for wherever the ledger says the driver is right now. Duplicated (not
// imported) from the identical helper in
// app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx — this is route
// composition over lib/phase's exports, kept local to each caller the same way that file
// keeps its own. When this screen is showing, the current phase is the ARRIVAL phase
// (`unloading`) rather than `in_transit`: the backend closed the in-transit row before the
// driver ever got here, which is exactly why `isDriving` has to derive the leg. So the
// generic walk below already lands on unloading's first step for free — no special case.
function currentStepRoute(phases: readonly PhaseDescriptor[]): string {
  const phase = currentPhase(phases)
  if (phase === null) return ROUTES.trips // nothing left unresolved — trip finished
  const steps = stepsFor(phase)
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
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
      className="w-full rounded-xl border-l-4 border-error bg-surface-container-lowest p-3 text-left shadow-ambient"
    >
      <p className="text-sm font-semibold text-error-on-container capitalize">
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
  const { capturePosition } = useLocationTrail()
  const [fix, setFix] = useState<DriverFix | null>(null)

  const tripIsOpen = trip !== null

  const refreshFix = useCallback(async (): Promise<void> => {
    const position = await capturePosition()
    // A failed fix must never erase the last good one. A driver in a cutting or under a
    // bridge still needs to see where they last were — and DriverMap labels an old fix
    // as last known rather than passing it off as current.
    if (position === null) return
    setFix({ position, capturedAt: new Date().toISOString() })
  }, [capturePosition])

  // POPIA (see the constraints in lib/context/LocationContext.tsx's header): this is the
  // narrowest possible tracking window. It runs only while a trip is OPEN, only while
  // this screen is MOUNTED, and only while the app is in the FOREGROUND — no
  // watchPosition subscription, no background-location permission, and nothing captured
  // here is transmitted anywhere. It is a display read for the driver's own map.
  useEffect(() => {
    if (!tripIsOpen) return

    void refreshFix()
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshFix()
    }, POSITION_REFRESH_MS)

    return () => window.clearInterval(timer)
  }, [tripIsOpen, refreshFix])

  if (isLoading) {
    return <LoadingScreen label="Loading trip" />
  }

  if (trip === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-lg text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  // Read the CONTEXT exceptions list, not trip.exceptions: the context value is the
  // trip's fetched/mock exceptions plus everything logged this session (TripContext
  // appends on logException), so a just-submitted exception shows up here immediately.
  // trip.exceptions is only a fetch-time snapshot and would silently drop it.
  const openExceptions = exceptions.filter((e) => !e.resolved)

  return (
    // h-dvh + overflow-hidden: this screen IS one viewport and nothing on it scrolls
    // except the exceptions list. dvh, not vh — 100vh resolves to the address-bar-hidden
    // height in a mobile browser and would push the action stack off the bottom.
    <main className="flex h-dvh flex-col overflow-hidden">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="Trip detail"
        onBack={() => router.push(ROUTES.activeTripDetail)}
        right={<span className="text-sm text-surface-on-variant">In Transit</span>}
      />

      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 py-2">
        <p className="text-sm uppercase tracking-industrial text-surface-on-variant">Planned arrival</p>
        <p className="text-base font-semibold text-surface-on">
          {trip.planned_arrival_at ? formatTime(trip.planned_arrival_at) : 'Not set'}
        </p>
      </div>

      {/* The map, and the largest element on the screen: it takes every pixel the header
          and the action stack do not need. min-h-0 is load-bearing — without it a flex
          child refuses to shrink below its content and pushes the stack off the bottom. */}
      <section className="min-h-0 flex-1 px-4 pb-3">
        <DriverMap
          position={fix?.position ?? null}
          capturedAt={fix?.capturedAt ?? null}
          onRetry={() => { void refreshFix() }}
          className="h-full w-full"
        />
      </section>

      {/* Everything the driver can do, in a block that never scrolls away. */}
      <div className="shrink-0 border-t border-outline-variant/60 bg-surface-container-lowest px-4 pt-3 pb-safe">
        {openExceptions.length > 0 && (
          <section className="mb-3 flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-error">
              <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {openExceptions.length} open exception{openExceptions.length > 1 ? 's' : ''}
            </p>
            {/* Height-capped and self-scrolling: a leg with eight exceptions must not be
                able to push the panic button below the fold. */}
            <div className={cn('flex flex-col gap-2 overflow-y-auto overscroll-contain', EXCEPTION_LIST_MAX_HEIGHT)}>
              {openExceptions.map((exc) => (
                <ExceptionCard key={exc.id} exception={exc} />
              ))}
            </div>
          </section>
        )}

        {/* The way out of this screen: walks to the arrival phase's first step. */}
        <Button
          size="lg"
          iconRight={<ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(currentStepRoute(trip.phases))}
        >
          Arrive at destination
        </Button>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="lg"
            iconLeft={<ScanFace className="h-4 w-4" strokeWidth={2} aria-hidden />}
            onClick={() => router.push(ROUTES.checkpoint)}
          >
            Checkpoint
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => router.push(ROUTES.exception)}
          >
            Log exception
          </Button>
        </div>

        <Button
          variant="danger"
          size="lg"
          className="mt-3"
          iconLeft={<ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.panic)}
        >
          Panic
        </Button>
      </div>
    </main>
  )
}
