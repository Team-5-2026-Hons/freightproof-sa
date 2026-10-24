'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { useGroupedTrips } from '@/lib/hooks/useGroupedTrips'
import { useRowsThatFit } from '@/lib/hooks/useRowsThatFit'
import { useTrip } from '@/lib/hooks/useTrip'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { TruckLoader } from '@/components/ui/TruckLoader'
import { ActiveTripCard } from '@/components/trip/ActiveTripCard'
import { DriverSubstitutionPanel } from '@/components/trip/DriverSubstitutionPanel'
import { TripEndedByDispatchBanner } from '@/components/trip/TripEndedByDispatchBanner'
import { useDriverSubstitutions } from '@/lib/hooks/useDriverSubstitutions'
import { TripList } from '@/components/trip/TripRow'
import { TAB_BAR_SPACER } from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

// Matches TripRow's min-h-[76px] plus the 1px rule between rows.
const TRIP_ROW_PX = 77
// Upcoming is a glance — the next trip or two; Past takes whatever height is left.
const UPCOMING_PREVIEW_WITH_ACTIVE = 1
const UPCOMING_PREVIEW = 2
// What Past shows before layout can be measured (first paint, jsdom).
const PAST_PREVIEW_FALLBACK = 2

function SeeAll({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="fill" size="pill-sm" onClick={onClick} aria-label={`See all ${label} trips`}>
      See all
    </Button>
  )
}

/**
 * Trips. One screen that never scrolls: the trip underway,
 * the next one or two, and as many past trips as fit above the tab bar — each list one
 * tap from its full, scrolling version under "See all".
 */
export default function TripsPage() {
  const router = useRouter()
  const { trip: sessionTrip } = useTrip()
  const { active, upcoming, past, isLoading, loadError, reload } = useGroupedTrips()
  // An incoming collection is not in /trips/me until custody actually transfers, so "No
  // trips yet" would be false for a driver whose only work is a pending handover.
  const { pending: pendingHandovers } = useDriverSubstitutions()
  const pastRef = useRef<HTMLDivElement>(null)
  const pastFits = useRowsThatFit(pastRef, TRIP_ROW_PX, PAST_PREVIEW_FALLBACK)

  const open = (trip: DriverTripSummary) => router.push(tripDetailHref(String(trip.id)))
  const current = active[0] ?? null
  const upcomingShown = upcoming.slice(0, current === null ? UPCOMING_PREVIEW : UPCOMING_PREVIEW_WITH_ACTIVE)

  if (isLoading) {
    return <div className="flex flex-1 items-center justify-center"><TruckLoader label="Loading your trips" /></div>
  }

  if (loadError !== null) {
    return (
      <div className="mx-4 mt-2 flex flex-col items-start gap-3 rounded-xl bg-error-tint px-4 py-3">
        <p className="text-subhead text-error">{loadError}</p>
        <Button variant="secondary" size="sm" onClick={reload}>Try Again</Button>
      </div>
    )
  }

  if (current === null && upcoming.length === 0 && past.length === 0 && pendingHandovers.length === 0) {
    return (
      <EmptyState
        icon={<Inbox strokeWidth={1.5} aria-hidden />}
        title="No trips yet"
        body="Your dispatcher assigns trips. They appear here the moment they’re planned."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3">
      <TripEndedByDispatchBanner className="mx-4 mb-4 shrink-0" />
      <DriverSubstitutionPanel className="mx-4 mb-4 shrink-0" />
      {current !== null && (
        <ActiveTripCard summary={current} trip={sessionTrip} onOpen={() => open(current)} />
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="trips-upcoming" className="mt-5 shrink-0">
          <SectionHeading
            id="trips-upcoming"
            title="Upcoming"
            action={<SeeAll label="upcoming" onClick={() => router.push(ROUTES.tripsUpcoming)} />}
          />
          {current !== null && (
            <p className="px-5 pt-1 text-footnote text-surface-on-variant">
              Finish your current trip before starting the next one.
            </p>
          )}
          <TripList trips={upcomingShown} kind="upcoming" onSelect={open} />
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="trips-past" className="mt-4 flex min-h-0 flex-1 flex-col">
          <SectionHeading
            id="trips-past"
            title="Past"
            action={<SeeAll label="past" onClick={() => router.push(ROUTES.tripsPast)} />}
          />
          {/* Measured, not scrolled: only whole rows that fit are rendered. */}
          <div ref={pastRef} className="min-h-0 flex-1 overflow-hidden">
            <TripList trips={past.slice(0, pastFits)} kind="past" onSelect={open} />
          </div>
        </section>
      )}
      {/* Clearance for the floating tab bar (see AppShell's TAB_BAR_SPACER). */}
      <div aria-hidden className={cn('shrink-0', TAB_BAR_SPACER)} />
    </div>
  )
}
