'use client'

import { useState, useMemo, useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { TopBar }           from '@/components/ui/TopBar'
import { SecHead }          from '@/components/ui/SecHead'
import { Button }           from '@/components/ui/Button'
import { Ic }               from '@/components/ui/Ic'
import { EmptyState }       from '@/components/ui/EmptyState'
import { DateRangePicker }  from '@/components/ui/DateRangePicker'
import { Pagination }       from '@/components/ui/Pagination'
import { Table }            from '@/components/ui/Table'
import { SearchField }      from '@/components/ui/SearchField'
import { FilterSelect }     from '@/components/ui/FilterSelect'
import { ListToolbar }      from '@/components/ui/ListToolbar'
import { buildTripColumns, tripRowClassName } from '@/components/trips/tripColumns'
import { useTripHistory }   from '@/lib/hooks/useTripHistory'
import { putTripSeeds }     from '@/lib/trips/tripSeed'
import { usePrecincts }     from '@/lib/hooks/usePrecincts'
import { useToast }         from '@/lib/hooks/useToast'
import { COPY }             from '@shared/lib/constants/copy'
import type { DateRange }   from '@/lib/types/date-range'
import type { TripHistoryListItem } from '@shared/lib/types/trip'

// Lower bound predates the platform, so the picker opens covering the full history by
// default — narrowing it is an explicit dispatcher action, not a silent default.
const HISTORY_RANGE_START = '2020-01-01'
const OPERATIONS_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function todayStr(): string {
  // The API interprets date filters on the configured operations calendar. South
  // African local date is derived by named zone, independent of process timezone
  // and without duplicating the backend's configurable numeric UTC offset.
  const parts = OPERATIONS_DATE_FORMATTER.formatToParts(new Date())
  const getPart = (type: Intl.DateTimeFormatPartTypes): string | undefined => (
    parts.find((part) => part.type === type)?.value
  )
  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  if (!year || !month || !day) throw new Error('Unable to resolve operations date')
  return `${year}-${month}-${day}`
}

// Names the stored column widths; History's must not share Dashboard's.
const HISTORY_TABLE_ID = 'history'
// Terminal trips: the date that matters is when the trip closed, never updated_at.
const CLOSED_DATE_COLUMN = { label: 'Closed', pick: (trip: TripHistoryListItem): string => trip.closed_at }
const NO_ROUTE_FILTER = ''

export default function HistoryPage() {
  const [search, setSearch]       = useState('')
  const [dateRange, setDateRange] = useState<DateRange>({ from: HISTORY_RANGE_START, to: todayStr() })
  const [precinctId, setPrecinctId] = useState('')
  const { notify } = useToast()

  const historyFilters = useMemo(() => ({
    q: search || undefined,
    precinctId: precinctId || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to,
  }), [search, precinctId, dateRange])
  const history = useTripHistory(historyFilters)
  // Same as the active list: a history row carries enough to name the trip on arrival.
  useEffect(() => { putTripSeeds(history.items) }, [history.items])
  const { precincts, error: precinctsError } = usePrecincts()

  useEffect(() => {
    if (history.error) {
      notify({ kind: 'error', title: 'Failed to load trip history', body: history.error })
    }
  }, [history.error, notify])

  // The precinct filter silently narrows to nothing when this list fails to load,
  // and route names fall back to an em-dash — neither is distinguishable from real data.
  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Origin and destination names may be missing.`,
      })
    }
  }, [precinctsError, notify])

  const hasNarrowedFilters = search.trim() !== ''
    || precinctId !== ''
    || dateRange.from !== HISTORY_RANGE_START
    || dateRange.to !== todayStr()

  // Built per render: route names depend on the loaded precincts.
  const columns = useMemo(
    () => buildTripColumns<TripHistoryListItem>({ precincts, date: CLOSED_DATE_COLUMN, showProgress: false }),
    [precincts],
  )

  // Only the very first load shows placeholder rows; a refetch keeps the rows on screen.
  const initialLoad = history.isLoading && history.items.length === 0
  const loadFailed = !!history.error && history.items.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Trip History" sub={`${history.totalItems} closed trips`} />

      <ListToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search trip ID, driver, or manifest number…" ariaLabel="Search trip ID, driver, or manifest number" />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <FilterSelect
          value={precinctId}
          onChange={setPrecinctId}
          ariaLabel="Route"
          options={[{ value: NO_ROUTE_FILTER, label: 'All routes' }, ...precincts.map(p => ({ value: p.id, label: p.name }))]}
        />
      </ListToolbar>

      {history.hasNewHistory && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-4 rounded-lg bg-sec-c px-5 py-3">
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-[12px] font-[600] text-sec-onc"
          >
            New trip history available
          </span>
          <Button size="sm" variant="ghost" onClick={history.showNewHistory}>
            New trip history available — show newest
          </Button>
        </div>
      )}

      {history.isStale && history.items.length > 0 && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-4 rounded-lg bg-warn-c px-5 py-3">
          <div className="flex items-center gap-[9px]">
            <Ic n="warn" s={14} className="shrink-0 text-warn-onc" />
            <span className="text-[12px] font-[600] text-warn-onc">
              This list may be out of date — the last refresh failed.
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={history.refetch}>Retry</Button>
        </div>
      )}

      {/* Trip list card */}
      <div className="flex-1 overflow-hidden mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 flex flex-col">
        <SecHead title="Closed Trips" />

        {loadFailed ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
            <AlertCircle className="w-10 h-10 text-error" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-surface-on">Failed to load trip history</p>
              <p className="text-xs text-surface-on-variant">{history.error}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={history.refetch}>
              Try again
            </Button>
          </div>
        ) : history.items.length === 0 && !initialLoad ? (
          <div className="p-6">
            {hasNarrowedFilters ? (
              <EmptyState
                icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                title={COPY.emptyState.noResults.title}
                body={COPY.emptyState.noResults.body}
              />
            ) : (
              <EmptyState
                icon={<Ic n="clock" s={32} className="text-on-surf-v" />}
                title="No trip history"
                body="Closed trips will appear here."
              />
            )}
          </div>
        ) : (
          // Server-paginated: header sorting is deliberately off, since sorting one page
          // would present a partial ordering as if it were the whole history.
          <Table<TripHistoryListItem>
            tableId={HISTORY_TABLE_ID}
            caption="Closed trips"
            isLoading={initialLoad}
            loadingLabel="Loading trip history"
            columns={columns}
            rows={history.items}
            getRowKey={trip => trip.id}
            rowClassName={tripRowClassName}
            density="compact"
            className="min-h-0 flex-1"
          />
        )}

        {!initialLoad && !loadFailed && (
          <div className="shrink-0 border-t border-outline-v/10 px-5 py-2">
            <Pagination
              page={history.page}
              pageSize={history.pageSize}
              itemCount={history.items.length}
              totalItems={history.totalItems}
              hasPrevious={history.hasPrevious}
              hasNext={history.hasNext}
              isLoading={history.isLoading}
              onPrevious={history.goToPreviousPage}
              onNext={history.goToNextPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
