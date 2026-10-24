'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useRouter } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { useGroupedTrips } from '@/lib/hooks/useGroupedTrips'
import { useBack } from '@/lib/navigation/useBack'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { TripList } from '@/components/trip/TripRow'
import { EmptyState } from '@/components/ui/EmptyState'

/** Every assigned trip not yet started, soonest first. */
export default function UpcomingTripsPage() {
  const router = useRouter()
  const goBack = useBack(ROUTES.trips)
  const { active, upcoming } = useGroupedTrips()

  return (
    <TabSubpage title="Upcoming trips" backLabel="Trips" onBack={goBack}>
      {upcoming.length === 0 ? (
        <EmptyState
          icon={<Inbox strokeWidth={1.5} aria-hidden />}
          title="No upcoming trips"
          body="New trips appear here as your dispatcher plans them."
        />
      ) : (
        <>
          {active.length > 0 && (
            <p className="px-5 pt-3 text-footnote text-surface-on-variant">
              Finish your current trip before starting the next one.
            </p>
          )}
          <div className="pt-2">
            <TripList trips={upcoming} kind="upcoming" onSelect={(trip) => router.push(tripDetailHref(String(trip.id)))} />
          </div>
          <p className="mx-4 mt-6 rounded-xl bg-fill px-4 py-4 text-center text-subhead text-surface-on-variant">
            That’s everything assigned to you. New trips appear here as your dispatcher plans them.
          </p>
        </>
      )}
    </TabSubpage>
  )
}
