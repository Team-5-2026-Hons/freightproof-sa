// frontend/driver-pwa/app/(app)/trips/page.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, SlidersHorizontal } from 'lucide-react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { useAuth } from '@/lib/hooks/useAuth'
import { fetchMyTrips } from '@/lib/api/trips'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { TruckLoader } from '@/components/ui/TruckLoader'
import { TripTable } from '@/components/trip/TripTable'
import { tripsForDriver, categorizeTrips, filterPastTrips, sortByDeparture } from '@/lib/utils/trip-filters'

type TabId = 'active' | 'upcoming' | 'past'

const EMPTY_STATE_COPY: Record<TabId, { title: string; body: string }> = {
  active:   { title: 'No active trip',   body: 'You have no trip in progress right now. Start one from Upcoming.' },
  upcoming: { title: 'No upcoming trips', body: 'Your dispatcher hasn’t assigned you a future trip yet.' },
  past:     { title: 'No matching trips', body: 'No past trips match these filters. Try widening the date range or clearing the search.' },
}

// Demo mode has no backend to call, so its rows are projected from the mock fixtures into
// the same DriverTripSummary shape the real endpoint returns — one row type downstream,
// so the tabs and filters below never branch on where the data came from.
function demoTripsFor(driverId: string): DriverTripSummary[] {
  return tripsForDriver(mockTrips, driverId as Parameters<typeof tripsForDriver>[1]).map((t) => ({
    id: t.id,
    trip_reference: t.trip_reference,
    order_number: t.order_number,
    status: t.status,
    trip_type: t.trip_type,
    origin_precinct_id: t.origin_precinct_id,
    destination_precinct_id: t.destination_precinct_id,
    origin_precinct_name: null,
    destination_precinct_name: null,
    planned_departure_at: t.planned_departure_at,
    actual_departure_at: t.actual_departure_at,
    planned_arrival_at: t.planned_arrival_at,
    actual_arrival_at: t.actual_arrival_at,
    open_exception_count: t.exceptions.filter((e) => !e.resolved).length,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }))
}

export default function TripsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Past-tab filters are collapsed by default to keep the list uncluttered.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // All three tabs now read one source: GET /trips/me, the driver's own trips in every
  // status. They previously read mock fixtures filtered by the signed-in driver's real
  // UUID, which matched no fixture and so rendered Upcoming and Past permanently empty
  // however many trips the dispatcher had actually assigned.
  const [trips, setTrips] = useState<DriverTripSummary[]>([])
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Keyed on the driver's id, not the user OBJECT: AuthContext builds its provider value
  // inline, so useAuth() hands back a fresh reference on every render. Depending on the
  // object would make `load` a new function each render and re-fire the fetch effect in a
  // loop; a primitive id only changes when the signed-in driver actually changes.
  const driverId = user?.id ?? null

  const demoTrips = useMemo(
    () => (driverId !== null ? demoTripsFor(driverId) : []),
    [driverId],
  )

  const load = useCallback(() => {
    if (IS_DEMO_MODE) { setTrips(demoTrips); setIsLoading(false); return }
    if (driverId === null) { setTrips([]); setIsLoading(false); return }
    setIsLoading(true)
    setLoadError(null)
    fetchMyTrips()
      .then(setTrips)
      // Surfaced, never swallowed: an empty list and a failed fetch look identical
      // otherwise, and "no upcoming trips" is a lie when the request simply didn't land.
      .catch((err: unknown) => {
        console.error('Failed to load the driver\'s trips', err)
        setLoadError('Could not load your trips. Check your connection and try again.')
      })
      .finally(() => setIsLoading(false))
  }, [driverId, demoTrips])

  useEffect(() => { load() }, [load])

  const { active, upcoming, past } = useMemo(() => {
    const grouped = categorizeTrips(trips)
    return {
      // Soonest departure first, so the next trip the driver leaves on is the top card
      // instead of wherever GET /trips/me happened to place it.
      active: sortByDeparture(grouped.active),
      upcoming: sortByDeparture(grouped.upcoming),
      // Past runs the other way: history is read most-recent-first, and oldest-first
      // would put a trip from months ago above the one finished this morning.
      past: sortByDeparture(grouped.past, 'latest-first'),
    }
  }, [trips])

  const filteredPast = useMemo(
    () => filterPastTrips(past, { dateFrom: dateFrom || null, dateTo: dateTo || null, search }),
    [past, dateFrom, dateTo, search],
  )

  const hasActiveTrip = active.length > 0
  const tripsToShow = tab === 'active' ? active : tab === 'upcoming' ? upcoming : filteredPast

  // Count of currently-set Past filters, shown as a badge on the Filter toggle
  // so an applied-but-collapsed filter stays discoverable.
  const activeFilterCount = [dateFrom, dateTo, search].filter((v) => v.trim() !== '').length

  return (
    // No min-h-screen — AppShell (the only caller, via app/(app)/layout.tsx) already
    // owns the fixed, locked-to-viewport frame and gives this page a sized,
    // scrollable slot; see AppShell.tsx for why stacking a second min-h-screen here
    // forced every visit to scroll regardless of how many trips there were to show.
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-surface-on">My Trips</h1>

      <Tabs
        tabs={[
          { id: 'active', label: 'Active', count: active.length },
          { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
          { id: 'past', label: 'Past', count: past.length },
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
            setFiltersOpen(false)
          }
        }}
      />

      {tab === 'upcoming' && hasActiveTrip && (
        <p className="rounded-xl bg-tertiary-container px-4 py-3 text-sm text-tertiary-on-container">
          Finish your active trip before starting the next one.
        </p>
      )}

      {tab === 'past' && (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            iconLeft={<SlidersHorizontal className="h-4 w-4" aria-hidden />}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filter
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {filtersOpen && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <Input label="Origin / destination" placeholder="e.g. Cape Town" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        // In-page, not LoadingScreen: the heading and tabs above stay on screen while the
        // list loads, so the loader belongs in the space the list will occupy rather than
        // floating over the whole viewport.
        <div className="flex justify-center py-16"><TruckLoader label="Loading your trips" /></div>
      ) : loadError !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-error-container px-4 py-3">
          <p className="text-sm text-error-on-container">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
        </div>
      ) : tripsToShow.length === 0 ? (
        <EmptyState
          icon={<Inbox strokeWidth={1.5} aria-hidden />}
          title={EMPTY_STATE_COPY[tab].title}
          body={EMPTY_STATE_COPY[tab].body}
        />
      ) : (
        <TripTable
          trips={tripsToShow}
          // Every row addresses its own trip by id, including Active ones. The old
          // Active-tab special case routed to /trips/active, which renders whatever
          // trip the CONTEXT holds — fine when a driver could only ever have one
          // non-terminal trip, wrong as soon as they have an active trip plus two
          // upcoming assignments.
          onSelect={(trip) =>
            router.push(
              IS_DEMO_MODE
                ? ROUTES.tripDetail(String(trip.id))
                : ROUTES.tripDetailById(String(trip.id)),
            )
          }
        />
      )}
    </main>
  )
}
