'use client'

import { useState, useMemo } from 'react'
import { Plus, AlertTriangle, CheckCircle2, Navigation } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { ChecklistRow } from '@/components/domain/ChecklistRow'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTrips } from '@/lib/hooks/useTrips'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { ROUTES } from '@/lib/constants/routes'
import { COPY } from '@shared/lib/constants/copy'
import type { TripStatus } from '@shared/lib/types/trip'

// Active trip statuses — everything except closed and cancelled
const ACTIVE_STATUSES: TripStatus[] = [
  'created', 'origin_gate_in', 'loading', 'origin_gate_out',
  'in_transit', 'dest_gate_in', 'unloading', 'exception_hold',
]

export default function ActiveTripsPage() {
  const router = useRouter()
  const allTrips = useTrips({ status: ACTIVE_STATUSES })
  const openExceptions = useExceptions({ resolved: false })
  const [search, setSearch] = useState('')

  // Filter trips by search term — matches on trip reference, driver name, or order number
  const filteredTrips = useMemo(() => {
    if (!search.trim()) return allTrips
    const term = search.toLowerCase()
    return allTrips.filter(t =>
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term)
    )
  }, [allTrips, search])

  // Derive headline metrics
  const activeCount = allTrips.length
  const openExceptionCount = openExceptions.length
  // On-time %: trips that arrived at or before planned arrival time
  const onTimePercent = useMemo(() => {
    const withArrival = allTrips.filter(t => t.actual_arrival_at && t.planned_arrival_at)
    if (withArrival.length === 0) return 100
    const onTime = withArrival.filter(t =>
      new Date(t.actual_arrival_at!) <= new Date(t.planned_arrival_at!)
    )
    return Math.round((onTime.length / withArrival.length) * 100)
  }, [allTrips])

  return (
    <PageShell>
      <PageHeader
        title="Active Trips"
        actions={
          <Button
            iconLeft={<Plus className="w-4 h-4" />}
            onClick={() => router.push(ROUTES.tripNew)}
          >
            New Trip
          </Button>
        }
      />

      {/* Headline metric strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card variant="section" className="flex items-center gap-4 p-4">
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-secondary/10">
            <Navigation className="w-5 h-5 text-secondary" />
          </span>
          <div>
            <p className="text-2xl font-black text-surface-on">{activeCount}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Active Trips</p>
          </div>
        </Card>

        <Card
          variant="section"
          className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-container transition-colors"
          onClick={() => router.push(ROUTES.exceptions)}
        >
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-error-container">
            <AlertTriangle className="w-5 h-5 text-error" />
          </span>
          <div>
            <p className="text-2xl font-black text-surface-on">{openExceptionCount}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Open Exceptions</p>
          </div>
        </Card>

        <Card variant="section" className="flex items-center gap-4 p-4">
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-success-container">
            <CheckCircle2 className="w-5 h-5 text-success" />
          </span>
          <div>
            <p className="text-2xl font-black text-surface-on">{onTimePercent}%</p>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">On-Time Today</p>
          </div>
        </Card>
      </div>

      {/* Search / filter bar */}
      <div className="mb-4">
        <Input
          label="Search"
          placeholder="Trip ID, driver, or order number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Trip list */}
      {allTrips.length === 0 ? (
        <EmptyState
          icon={<Navigation />}
          title={COPY.emptyState.activeTrips.title}
          body={COPY.emptyState.activeTrips.body}
        />
      ) : filteredTrips.length === 0 ? (
        <EmptyState
          icon={<Navigation />}
          title={COPY.emptyState.noResults.title}
          body={COPY.emptyState.noResults.body}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filteredTrips.map(trip => (
            <ChecklistRow key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </PageShell>
  )
}
