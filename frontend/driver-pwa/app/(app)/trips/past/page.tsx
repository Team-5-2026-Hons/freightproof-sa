'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, SlidersHorizontal } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { useGroupedTrips } from '@/lib/hooks/useGroupedTrips'
import { useBack } from '@/lib/navigation/useBack'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { filterPastTrips } from '@/lib/utils/trip-filters'
import { groupByMonth } from '@/lib/utils/trip-display'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { TripList } from '@/components/trip/TripRow'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Every past trip, by month — the scrolling list behind the Trips tab's
 * "See all". The place/date filter the old Past tab had lives here now.
 */
export default function PastTripsPage() {
  const router = useRouter()
  const goBack = useBack(ROUTES.trips)
  const { past } = useGroupedTrips()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const shown = useMemo(
    () => filterPastTrips(past, { dateFrom: dateFrom || null, dateTo: dateTo || null, search }),
    [past, dateFrom, dateTo, search],
  )
  const groups = groupByMonth(shown)
  const activeFilters = [search, dateFrom, dateTo].filter((v) => v.trim() !== '').length

  return (
    <TabSubpage
      title="Past trips"
      backLabel="Trips"
      onBack={goBack}
      right={
        <Button
          variant="fill"
          size="pill-sm"
          aria-expanded={filtersOpen}
          iconLeft={<SlidersHorizontal className="size-4" strokeWidth={2} aria-hidden />}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filter{activeFilters > 0 ? ` · ${activeFilters}` : ''}
        </Button>
      }
    >
      {filtersOpen && (
        <div className="flex flex-col gap-3 px-4 pt-3">
          <Input label="Origin or destination" placeholder="e.g. Durban" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Inbox strokeWidth={1.5} aria-hidden />}
          title={past.length === 0 ? 'No past trips yet' : 'No matching trips'}
          body={past.length === 0 ? 'Finished trips are kept here as your record.' : 'Try a wider date range or a different place.'}
        />
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-labelledby={`month-${group.label}`}>
            {/* Sticky month heading, like the iOS Photos/Wallet lists. */}
            <h2
              id={`month-${group.label}`}
              className="glass-nav sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-raised px-5 pb-1.5 pt-4 text-subhead font-semibold text-surface-on-variant"
            >
              {group.label}
            </h2>
            <TripList trips={group.trips} kind="past" onSelect={(trip) => router.push(tripDetailHref(String(trip.id)))} />
          </section>
        ))
      )}
    </TabSubpage>
  )
}
