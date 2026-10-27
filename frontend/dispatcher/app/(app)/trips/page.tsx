'use client'

import { Suspense, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { TopBar }         from '@/components/ui/TopBar'
import { SecHead }        from '@/components/ui/SecHead'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { EmptyState }     from '@/components/ui/EmptyState'
import { Table }          from '@/components/ui/Table'
import { Spinner }        from '@/components/ui/Spinner'
import { Tabs, type Tab } from '@/components/ui/Tabs'
import { SearchField }    from '@/components/ui/SearchField'
import { ListToolbar }    from '@/components/ui/ListToolbar'
import { buildTripColumns, tripRowClassName } from '@/components/trips/tripColumns'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { useActiveTrips } from '@/lib/hooks/useActiveTrips'
import { useTableSort }   from '@/lib/hooks/useTableSort'
import { useUrlListState } from '@/lib/hooks/useUrlListState'
import { TRIP_LIST_CODEC, TRIP_TABS, type TripTab } from '@/lib/trips/list-view-state'
import { matchesTripSearch } from '@/lib/trips/search'
import { defaultTripSortDirection, sortTrips, TRIP_ATTENTION_SORT, TRIP_SORT_KEYS } from '@/lib/trips/sort'
import { ROUTES }         from '@/lib/constants/routes'
import { COPY }           from '@shared/lib/constants/copy'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'

const ACTIVE_TRIPS_TABLE_ID = 'active-trips'
const TRIPS_CARD_MIN_HEIGHT = 'min-h-[18rem]'
const CREATED_DATE_COLUMN = { label: 'Created', pick: (trip: TripSummary): string => trip.created_at }

const TAB_STATUS: Record<Exclude<TripTab, 'all'>, TripStatus> = { created: 'created', active: 'active' }
const TAB_LABEL: Record<TripTab, string> = { all: 'All', created: 'Scheduled', active: 'In progress' }
const TAB_EMPTY_TITLE: Record<Exclude<TripTab, 'all'>, string> = { created: 'No scheduled trips', active: 'No trips in progress' }
const TAB_PANEL_ID = 'active-trips-panel'

const inTab = (trip: TripSummary, tab: TripTab): boolean => tab === 'all' || trip.status === TAB_STATUS[tab]

export default function ActiveTripsPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading trips" className="flex flex-1 items-center justify-center"><Spinner size="lg" /></div>}>
      <ActiveTripsList />
    </Suspense>
  )
}

function ActiveTripsList() {
  const router = useRouter()
  const { state: { tab }, update, search, setSearch, href: listHref } = useUrlListState(TRIP_LIST_CODEC)
  const { sort, tableSort, onSort } = useTableSort({
    keys: TRIP_SORT_KEYS,
    firstDir: defaultTripSortDirection,
    initial: TRIP_ATTENTION_SORT,
  })
  const { trips, precincts, initialLoad, loadFailed, error, refetch } = useActiveTrips()

  const tabs = useMemo<Tab[]>(
    () => TRIP_TABS.map(id => ({ id, label: TAB_LABEL[id], badge: trips.filter(trip => inTab(trip, id)).length })),
    [trips],
  )

  const visibleTrips = useMemo(() => {
    const matching = trips.filter(trip => inTab(trip, tab) && matchesTripSearch(trip, search))
    return sortTrips(matching, sort, precincts)
  }, [trips, tab, search, sort, precincts])

  const columns = useMemo(
    () => buildTripColumns<TripSummary>({
      precincts, date: CREATED_DATE_COLUMN, showProgress: true, sortable: true,
      hrefFor: id => withReturnTo(ROUTES.tripDetail(id), listHref),
    }),
    [precincts, listHref],
  )

  const tabTripCount = tabs.find(t => t.id === tab)?.badge ?? 0
  const emptyIcon = (n: 'truck' | 'search') => <Ic n={n} s={32} className="text-on-surf-v" />

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Active Trips">
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ListToolbar>
          <Tabs
            tabs={tabs}
            active={tab}
            onChange={id => update({ tab: id as TripTab })}
            panelId={TAB_PANEL_ID}
            ariaLabel="Trip status"
            size="sm"
            fit="content"
            idPrefix="active-trips-tab"
          />
          <SearchField value={search} onChange={setSearch} placeholder="Search trip ID, driver, or manifest…" ariaLabel="Search trip ID, driver, or manifest" />
        </ListToolbar>

        <div id={TAB_PANEL_ID} role="tabpanel" aria-labelledby={`active-trips-tab-${tab}`} className={`flex-1 overflow-hidden mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 flex flex-col ${TRIPS_CARD_MIN_HEIGHT}`}>
          <SecHead title="Active Trips" />

          {loadFailed ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
              <AlertCircle className="w-10 h-10 text-error" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold text-surface-on">Failed to load trips</p>
                <p className="text-xs text-surface-on-variant">{error}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={refetch}>
                Try again
              </Button>
            </div>
          ) : !initialLoad && trips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={emptyIcon('truck')}
                title={COPY.emptyState.activeTrips.title}
                body={COPY.emptyState.activeTrips.body}
              />
            </div>
          ) : !initialLoad && tabTripCount === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={emptyIcon('truck')}
                title={tab === 'all' ? COPY.emptyState.activeTrips.title : TAB_EMPTY_TITLE[tab]}
                body="Trips in this state will appear here."
              />
            </div>
          ) : !initialLoad && visibleTrips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={emptyIcon('search')}
                title={COPY.emptyState.noResults.title}
                body={COPY.emptyState.noResults.body}
              />
            </div>
          ) : (
            <Table<TripSummary>
              tableId={ACTIVE_TRIPS_TABLE_ID}
              caption="Active trips"
              isLoading={initialLoad}
              loadingLabel="Loading active trips"
              columns={columns}
              rows={visibleTrips}
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
    </div>
  )
}
