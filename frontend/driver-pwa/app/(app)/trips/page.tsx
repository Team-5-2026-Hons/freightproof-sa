// frontend/driver-pwa/app/(app)/trips/page.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { ROUTES } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTrip } from '@/lib/hooks/useTrip'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { tripsForDriver, categorizeTrips, filterPastTrips } from '@/lib/utils/trip-filters'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'

type TabId = 'active' | 'upcoming' | 'past'

const EMPTY_STATE_COPY: Record<TabId, { title: string; body: string }> = {
  active:   { title: 'No active trip',   body: 'You have no trip in progress right now.' },
  upcoming: { title: 'No upcoming trips', body: 'Your dispatcher hasn’t assigned you a future trip yet.' },
  past:     { title: 'No matching trips', body: 'No past trips match these filters. Try widening the date range or clearing the search.' },
}

function TripCard({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const { kind, label } = tripStatusChip(trip.status)
  return (
    <Card onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-surface-on">{trip.trip_reference}</p>
          <p className="text-sm text-surface-on-variant">{trip.order_number}</p>
        </div>
        <Chip kind={kind}>{label}</Chip>
      </div>
    </Card>
  )
}

export default function TripsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { trip: activeTrip } = useTrip()
  const [tab, setTab] = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // No backend endpoint exists yet for a driver's trip history — upcoming/past
  // stay on mock data until GET /driver/trips (history) is built.
  const driverTrips = useMemo(
    () => (user ? tripsForDriver(mockTrips, user.id) : []),
    [user],
  )
  const { upcoming, past } = useMemo(() => categorizeTrips(driverTrips), [driverTrips])

  // The Active tab mirrors the Home screen: backed by the real GET /trips/me/active call.
  const active = useMemo(
    () => (activeTrip && !['closed', 'cancelled'].includes(activeTrip.status) ? [activeTrip] : []),
    [activeTrip],
  )

  const filteredPast = useMemo(
    () => filterPastTrips(past, { dateFrom: dateFrom || null, dateTo: dateTo || null, search }),
    [past, dateFrom, dateTo, search],
  )

  const hasActiveTrip = active.length > 0
  const tripsToShow = tab === 'active' ? active : tab === 'upcoming' ? upcoming : filteredPast

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">My Trips</h1>

      <Tabs
        tabs={[
          { id: 'active', label: `Active (${active.length})` },
          { id: 'upcoming', label: `Upcoming (${upcoming.length})` },
          { id: 'past', label: `Past (${past.length})` },
        ]}
        active={tab}
        onChange={(id) => {
          const nextTab = id as TabId
          setTab(nextTab)
          // Filters are only visible on the Past tab; clear them on the way out
          // so a stale, hidden filter can't silently narrow results on return.
          if (nextTab !== 'past') {
            setSearch('')
            setDateFrom('')
            setDateTo('')
          }
        }}
      />

      {tab === 'upcoming' && hasActiveTrip && (
        <p className="rounded-xl bg-tertiary-container px-4 py-3 text-sm text-tertiary-on-container">
          Finish your active trip before starting the next one.
        </p>
      )}

      {tab === 'past' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input label="Origin / destination" placeholder="e.g. JHB" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {tripsToShow.length === 0 ? (
        <EmptyState
          icon={<Inbox strokeWidth={1.5} aria-hidden />}
          title={EMPTY_STATE_COPY[tab].title}
          body={EMPTY_STATE_COPY[tab].body}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {tripsToShow.map((trip) => (
            <li key={trip.id}>
              <TripCard
                trip={trip}
                onClick={() => router.push(tab === 'active' ? ROUTES.activeTripDetail : ROUTES.tripDetail(String(trip.id)))}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
