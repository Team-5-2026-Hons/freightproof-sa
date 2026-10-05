'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { TopBar }         from '@/components/ui/TopBar'
import { SecHead }        from '@/components/ui/SecHead'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { EmptyState }     from '@/components/ui/EmptyState'
import { Table }          from '@/components/ui/Table'
import { SearchField }    from '@/components/ui/SearchField'
import { ListToolbar }    from '@/components/ui/ListToolbar'
import { buildTripColumns, tripRowClassName } from '@/components/trips/tripColumns'
import { useTrips }       from '@/lib/hooks/useTrips'
import { putTripSeeds }   from '@/lib/trips/tripSeed'
import { matchesTripSearch } from '@/lib/trips/search'
import { defaultTripSortDirection, sortTrips, TRIP_SORT_KEYS } from '@/lib/trips/sort'
import { useTableSort } from '@/lib/hooks/useTableSort'
import { useAuth }        from '@/lib/hooks/useAuth'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
import { useToast }       from '@/lib/hooks/useToast'
import { ROUTES }         from '@/lib/constants/routes'
import { COPY }           from '@shared/lib/constants/copy'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'

// Coarse: `active` is every trip between creation and
// closure. The old list enumerated six per-step statuses from the pre-phase model
// that no longer exist, so every advanced trip silently disappeared from this dashboard.
// `exception_hold` currently matches nothing — no backend path sets it (see
// orchestration/phase_service.py's _is_resolved). Kept so a held trip would appear
// here by default if a manual dispatcher hold lands, rather than vanishing from the
// dashboard the way the pre-phase statuses did.
const ACTIVE_STATUSES: TripStatus[] = ['created', 'active', 'exception_hold']

// Names the stored column widths; the Dashboard's must not share History's.
const DASHBOARD_TABLE_ID = 'dashboard'
const CREATED_DATE_COLUMN = { label: 'Created', pick: (trip: TripSummary): string => trip.created_at }

export default function ActiveTripsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { notify } = useToast()
  const [search, setSearch] = useState('')
  // No initial sort: until a header is clicked the list keeps the order the API sends, so the page
  // never reorders itself. Local state, because this page has no URL state to join.
  const { sort, tableSort, onSort } = useTableSort({ keys: TRIP_SORT_KEYS, firstDir: defaultTripSortDirection })

  // Single fetch for all trips — active and closed are derived client-side
  const { trips: allFetchedTrips, isLoading: tripsLoading, error: tripsError, refetch: refetchTrips } = useTrips()
  // Hand what this list already knows to the detail page, so opening a row paints its
  // header immediately instead of waiting on the full record.
  useEffect(() => { putTripSeeds(allFetchedTrips) }, [allFetchedTrips])
  const { precincts, error: precinctsError } = usePrecincts()

  useEffect(() => {
    if (tripsError) {
      notify({ kind: 'error', title: 'Failed to load trips', body: tripsError })
    }
  }, [tripsError, notify])

  // Without this the failure is invisible: rows fall back to an em-dash, which is
  // indistinguishable from a trip that has no origin.
  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Origin and destination names may be missing.`,
      })
    }
  }, [precinctsError, notify])

  const allTrips = useMemo(
    () => allFetchedTrips.filter(t => ACTIVE_STATUSES.includes(t.status)),
    [allFetchedTrips],
  )

  const filteredTrips = useMemo(() => {
    const matching = allTrips.filter(t => matchesTripSearch(t, search))
    return sort ? sortTrips(matching, sort, precincts) : matching
  }, [allTrips, search, sort, precincts])

  // Built per render: route names depend on the loaded precincts.
  const columns = useMemo(
    () => buildTripColumns<TripSummary>({ precincts, date: CREATED_DATE_COLUMN, showProgress: true, sortable: true }),
    [precincts],
  )

  // Skeleton rows only on the first load: a live refetch swaps rows in place.
  const initialLoad = tripsLoading && allFetchedTrips.length === 0
  const loadFailed = !!tripsError && allFetchedTrips.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Dispatcher Dashboard"
        badge={user?.role === 'admin_dispatcher' ? (
          <span className="inline-flex items-center gap-[4px] rounded-[var(--r-sm)] bg-surf-high px-[8px] py-[3px] text-[11px] font-[600] tracking-[0.04em] text-on-surf-v">
            <Ic n="shield" s={11} className="text-on-surf-v shrink-0" />
            Admin
          </span>
        ) : undefined}
        sub={`${fmtSastDateParts(new Date().toISOString())?.day ?? ''} · Load Factor Transport`}
      >
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      {/* No stat strip: fleet figures live on the Analytics page. */}

      <ListToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search trip ID, driver, or manifest…" ariaLabel="Search trip ID, driver, or manifest" />
      </ListToolbar>

      {/* Trip list card */}
      <div className="flex-1 overflow-hidden mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 flex flex-col">
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {loadFailed ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
            <AlertCircle className="w-10 h-10 text-error" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-surface-on">Failed to load trips</p>
              <p className="text-xs text-surface-on-variant">{tripsError}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={refetchTrips}>
              Try again
            </Button>
          </div>
        ) : !initialLoad && allTrips.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Ic n="truck" s={32} className="text-on-surf-v" />}
              title={COPY.emptyState.activeTrips.title}
              body={COPY.emptyState.activeTrips.body}
            />
          </div>
        ) : !initialLoad && filteredTrips.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Ic n="search" s={32} className="text-on-surf-v" />}
              title={COPY.emptyState.noResults.title}
              body={COPY.emptyState.noResults.body}
            />
          </div>
        ) : (
          <Table<TripSummary>
            tableId={DASHBOARD_TABLE_ID}
            caption="Active trips"
            isLoading={initialLoad}
            loadingLabel="Loading active trips"
            columns={columns}
            rows={filteredTrips}
            getRowKey={trip => trip.id}
            rowClassName={tripRowClassName}
            sort={tableSort}
            onSort={onSort}
            density="compact"
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  )
}
