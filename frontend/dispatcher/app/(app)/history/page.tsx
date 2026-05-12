'use client'

import { useState } from 'react'
import { History, SlidersHorizontal, Download } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { ChecklistRow } from '@/components/domain/ChecklistRow'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTrips } from '@/lib/hooks/useTrips'
import { COPY } from '@shared/lib/constants/copy'

export default function TripHistoryPage() {
  const allTrips = useTrips({ status: ['closed', 'cancelled'] })
  const [search, setSearch] = useState('')

  // Filter trips by search term
  const filteredTrips = allTrips.filter(t => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return (
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term)
    )
  })

  return (
    <PageShell>
      <PageHeader
        title="Trip History"
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Download className="w-4 h-4" />}
          >
            Export CSV
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1">
          <Input
            label="Search"
            placeholder="Trip ID, driver, or order number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="mt-[26px]"> {/* Align with input below label */}
          <Button variant="secondary" iconLeft={<SlidersHorizontal className="w-4 h-4" />}>
            Filters
          </Button>
        </div>
      </div>

      {/* Trip list */}
      {allTrips.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={COPY.emptyState.history.title}
          body={COPY.emptyState.history.body}
        />
      ) : filteredTrips.length === 0 ? (
        <EmptyState
          icon={<History />}
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
