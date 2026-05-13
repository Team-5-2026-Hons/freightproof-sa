'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }         from '@/components/ui/TopBar'
import { StatCard }       from '@/components/ui/StatCard'
import { SecHead }        from '@/components/ui/SecHead'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { EmptyState }     from '@/components/ui/EmptyState'
import { ChecklistRow }   from '@/components/domain/ChecklistRow'
import { ExceptionBanner } from '@/components/domain/ExceptionBanner'
import { useTrips }       from '@/lib/hooks/useTrips'
import { useExceptions }  from '@/lib/hooks/useExceptions'
import { ROUTES }         from '@/lib/constants/routes'
import { COPY }           from '@shared/lib/constants/copy'
import { mockTrips }      from '@shared/lib/mocks/trips'
import type { TripStatus } from '@shared/lib/types/trip'

const ACTIVE_STATUSES: TripStatus[] = [
  'created', 'origin_gate_in', 'loading', 'origin_gate_out',
  'in_transit', 'dest_gate_in', 'unloading', 'exception_hold',
]

const CLOSED_STATUS: TripStatus[] = ['closed']

const COLUMNS = [
  { label: 'TRIP ID',        width: 88  },
  { label: 'ORDER',          width: 100 },
  { label: 'DRIVER / HORSE', width: 115 },
  { label: 'ROUTE',          width: 100 },
  { label: 'PROGRESS',       width: null },
  { label: 'STATUS',         width: 90  },
] as const

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ActiveTripsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const allTrips      = useTrips({ status: ACTIVE_STATUSES })
  const closedTrips   = useTrips({ status: CLOSED_STATUS })
  const openExceptions = useExceptions({ resolved: false })

  const todayStr = new Date().toDateString()
  const completedCount = useMemo(
    () => closedTrips.filter(t => new Date(t.updated_at).toDateString() === todayStr).length,
    [closedTrips, todayStr],
  )

  const onTimePercent = useMemo(() => {
    const withArrival = allTrips.filter(t => t.actual_arrival_at && t.planned_arrival_at)
    if (withArrival.length === 0) return 100
    const onTime = withArrival.filter(
      t => new Date(t.actual_arrival_at!) <= new Date(t.planned_arrival_at!),
    )
    return Math.round((onTime.length / withArrival.length) * 100)
  }, [allTrips])

  const exceptionDescription = useMemo(() => {
    return openExceptions.slice(0, 2).map(e => {
      const trip = mockTrips.find(t => t.id === e.trip_id)
      const ref  = trip?.trip_reference ?? 'Unknown'
      return `${ref}: ${e.exception_type.replace(/_/g, ' ')}`
    }).join(' · ')
  }, [openExceptions])

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
      <TopBar
        title="Dashboard"
        sub={`${formatDate(new Date())} · Load Factor Transport`}
      >
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      {/* Stat strip */}
      <div className="flex gap-3 px-6 py-4 bg-surf-low shrink-0">
        <StatCard value={String(allTrips.length)}   label="Active trips" />
        <StatCard value={String(openExceptions.length)} label="Exceptions today" warn={openExceptions.length > 0} />
        <StatCard value={String(completedCount)}    label="Completed today" />
        <StatCard value={`${onTimePercent}%`}       label="On-time rate (30d)" success />
      </div>

      {/* Exception banner — only when open exceptions exist */}
      {openExceptions.length > 0 && (
        <div className="mx-6 mt-4 shrink-0">
          <ExceptionBanner
            title={`${openExceptions.length} exception${openExceptions.length > 1 ? 's' : ''} require review`}
            description={exceptionDescription}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(ROUTES.exceptions)}
              >
                View all
              </Button>
            }
          />
        </div>
      )}

      {/* Search */}
      <div className="px-6 py-3 shrink-0">
        <div className="relative">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          />
        </div>
      </div>

      {/* Trip list card */}
      <div className="flex-1 overflow-auto mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden flex flex-col">
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {/* Column header row */}
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

        {/* Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-outline-v/10">
          {allTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Ic n="truck" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.activeTrips.title}
                body={COPY.emptyState.activeTrips.body}
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
