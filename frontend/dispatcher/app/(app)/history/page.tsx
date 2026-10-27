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
import { sastToday }        from '@shared/lib/utils/datetime'
import type { DateRange }   from '@/lib/types/date-range'
import type { TripHistoryListItem } from '@shared/lib/types/trip'

const HISTORY_RANGE_START = '2020-01-01'

const HISTORY_TABLE_ID = 'history'
const CLOSED_DATE_COLUMN = { label: 'Closed', pick: (trip: TripHistoryListItem): string => trip.closed_at }
const NO_ROUTE_FILTER = ''

export default function HistoryPage() {
  const [search, setSearch]       = useState('')
  const [pickedRange, setPickedRange] = useState<DateRange | null>(null)
  const today = sastToday()
  const dateRange: DateRange = pickedRange ?? { from: HISTORY_RANGE_START, to: today }
  const [precinctId, setPrecinctId] = useState('')
  const { notify } = useToast()

  const searchTerm = search.trim()
  const rangeFrom = dateRange.from
  const rangeTo = dateRange.to
  const historyFilters = useMemo(() => ({
    q: searchTerm || undefined,
    precinctId: precinctId || undefined,
    fromDate: rangeFrom,
    toDate: rangeTo,
  }), [searchTerm, precinctId, rangeFrom, rangeTo])
  const history = useTripHistory(historyFilters)
  useEffect(() => { putTripSeeds(history.items) }, [history.items])
  const { precincts, error: precinctsError } = usePrecincts()

  useEffect(() => {
    if (history.error) {
      notify({ kind: 'error', title: 'Failed to load trip history', body: history.error })
    }
  }, [history.error, notify])

  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Origin and destination names may be missing.`,
      })
    }
  }, [precinctsError, notify])

  const hasNarrowedFilters = searchTerm !== ''
    || precinctId !== ''
    || dateRange.from !== HISTORY_RANGE_START
    || dateRange.to !== today

  const columns = useMemo(
    () => buildTripColumns<TripHistoryListItem>({ precincts, date: CLOSED_DATE_COLUMN, showProgress: false }),
    [precincts],
  )

  const initialLoad = history.isLoading && history.items.length === 0
  const loadFailed = !!history.error && history.items.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Trip History" sub={`${history.totalItems} closed trips`} />

      <ListToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search trip ID, driver, or manifest number…" ariaLabel="Search trip ID, driver, or manifest number" />
        <DateRangePicker value={dateRange} onChange={setPickedRange} />
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
            New trip history available. Show newest
          </Button>
        </div>
      )}

      {history.isStale && history.items.length > 0 && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-4 rounded-lg bg-warn-c px-5 py-3">
          <div className="flex items-center gap-[9px]">
            <Ic n="warn" s={14} className="shrink-0 text-warn-onc" />
            <span className="text-[12px] font-[600] text-warn-onc">
              This list may be out of date. The last refresh failed.
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={history.refetch}>Retry</Button>
        </div>
      )}

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
