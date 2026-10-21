'use client'

import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { Table } from '@/components/ui/Table'
import { DashboardPanel } from '@/components/dashboard/DashboardPanel'
import { buildTripColumns, tripRowClassName } from '@/components/trips/tripColumns'
import { ROUTES } from '@/lib/constants/routes'
import { DASHBOARD_TRIP_LIMIT, activeTripsByAttention } from '@/lib/dashboard/attention'
import { useActiveTrips } from '@/lib/hooks/useActiveTrips'
import type { TripSummary } from '@shared/lib/types/trip'

const TABLE_ID = 'dashboard-trips'
const CREATED_DATE_COLUMN = { label: 'Created', pick: (trip: TripSummary): string => trip.created_at }

/** The dashboard's trips panel: every active trip, those with exceptions waiting on a dispatcher
 *  first, capped. The full searchable list lives on the Active Trips page. */
export function DashboardTripsPanel(): React.JSX.Element {
  const { trips, precincts, initialLoad, loadFailed, error, refetch } = useActiveTrips()
  const ordered = useMemo(() => activeTripsByAttention(trips, precincts), [trips, precincts])
  const needAction = useMemo(() => trips.filter(trip => trip.needs_review_count > 0).length, [trips])
  // Built per render: route names depend on the loaded precincts. No sorting: the panel's order is
  // the point of it, and eight rows have nothing to search.
  const columns = useMemo(
    () => buildTripColumns<TripSummary>({ precincts, date: CREATED_DATE_COLUMN, showProgress: true }),
    [precincts],
  )

  return (
    <DashboardPanel
      title="Active trips"
      count={initialLoad || loadFailed ? null : `${trips.length} active · ${needAction} ${needAction === 1 ? 'needs' : 'need'} action`}
      noun="active trips"
      viewAllHref={ROUTES.trips}
      className="min-h-0 flex-1"
    >
      {loadFailed ? (
        <EmptyState
          className="py-8"
          icon={<AlertCircle />}
          title="Failed to load trips"
          body={error ?? ''}
          cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
        />
      ) : !initialLoad && ordered.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Ic n="truck" s={32} />}
          title="No active trips"
          body="Trips between creation and closure appear here."
        />
      ) : (
        // Fills what the other two panels leave, so they stay fully visible; the rest scrolls here.
        <Table<TripSummary>
          tableId={TABLE_ID}
          caption="Active trips"
          isLoading={initialLoad}
          loadingLabel="Loading trips"
          skeletonRows={DASHBOARD_TRIP_LIMIT}
          columns={columns}
          rows={ordered.slice(0, DASHBOARD_TRIP_LIMIT)}
          getRowKey={trip => trip.id}
          rowClassName={tripRowClassName}
          density="compact"
          className="min-h-0 flex-1"
        />
      )}
    </DashboardPanel>
  )
}
