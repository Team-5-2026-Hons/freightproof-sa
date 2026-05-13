'use client'

import { useState, useMemo } from 'react'
import { TopBar }       from '@/components/ui/TopBar'
import { SecHead }      from '@/components/ui/SecHead'
import { Ic }           from '@/components/ui/Ic'
import { EmptyState }   from '@/components/ui/EmptyState'
import { ChecklistRow } from '@/components/domain/ChecklistRow'
import { useTrips }     from '@/lib/hooks/useTrips'
import { COPY }         from '@shared/lib/constants/copy'
import type { TripStatus } from '@shared/lib/types/trip'

const CLOSED_STATUS: TripStatus[] = ['closed', 'cancelled']

const COLUMNS = [
  { label: 'TRIP ID',        width: 88  },
  { label: 'ORDER',          width: 100 },
  { label: 'DRIVER / HORSE', width: 115 },
  { label: 'ROUTE',          width: 100 },
  { label: 'PROGRESS',       width: null },
  { label: 'STATUS',         width: 90  },
] as const

export default function HistoryPage() {
  const [search, setSearch] = useState('')
  const allTrips = useTrips({ status: CLOSED_STATUS })

  const filteredTrips = useMemo(() => {
    if (!search.trim()) return allTrips
    const term = search.toLowerCase()
    return allTrips.filter(t =>
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term),
    )
  }, [allTrips, search])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Trip History" sub={`${allTrips.length} closed trips`} />

      {/* Search / filter bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-surf-low border-b border-outline-v/20 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-lowest rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec transition-colors"
          />
        </div>
      </div>

      {/* Trip list card */}
      <div className="flex-1 overflow-auto mx-6 my-6 bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden flex flex-col">
        <SecHead title="Closed Trips" />

        <div className="flex gap-3 px-6 py-[7px] bg-surf-low shrink-0">
          {COLUMNS.map(col => (
            <div
              key={col.label}
              style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1 }}
              className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v"
            >
              {col.label}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-outline-v/10">
          {allTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="clock" s={32} className="text-on-surf-v" />}
                title="No trip history"
                body="Closed trips will appear here."
              />
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.noResults.title}
                body={COPY.emptyState.noResults.body}
              />
            </div>
          ) : (
            filteredTrips.map(trip => (
              <ChecklistRow key={trip.id} trip={trip} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
