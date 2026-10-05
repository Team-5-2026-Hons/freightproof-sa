'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FIRST_HISTORY_PAGE, parseExceptionViewState, serializeExceptionViewState, type ExceptionListViewState, type ExceptionHistoryNavigationState } from '@/lib/exceptions/view-state'
import { useExceptionListRestoration } from '@/lib/hooks/useExceptionListRestoration'
import { TopBar } from '@/components/ui/TopBar'
import { SecHead } from '@/components/ui/SecHead'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { Table, type TableGroup } from '@/components/ui/Table'
import { Tabs, type Tab as TabItem } from '@/components/ui/Tabs'
import { SearchField } from '@/components/ui/SearchField'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { buildExceptionColumns, EXCEPTION_TABLE_ID } from '@/components/exceptions/exceptionColumns'
import { filterQueue, sortQueue, sortQueueChronologically, groupQueueByTrip, type ExceptionSortKey, type ExceptionTripGroup } from '@/lib/exceptions/queue'
import { useExceptionQueue } from '@/lib/hooks/useExceptions'
import { useExceptionHistory } from '@/lib/hooks/useExceptionHistory'
import { useAuth } from '@/lib/hooks/useAuth'
import { useNow } from '@/lib/hooks/useNow'
import { useClaimChanges } from '@/lib/hooks/useClaimChanges'
import { exceptionCalendarDay, fmtExceptionRaised } from '@/lib/format/exception'
import { reviewState } from '@/lib/format/review-state'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { ExceptionSeverity, TripExceptionListItem } from '@shared/lib/types/exception'

const SEARCH_DEBOUNCE_MS = 300
// Relative claim times ("2 min ago") are minute-granular, so a half-minute tick is enough.
const CLOCK_TICK_MS = 30_000
const MS_PER_DAY = 86_400_000
const PRESET_WEEK_DAYS = 7
const PRESET_MONTH_DAYS = 30
// Predates the platform, so an untouched range means "all time", the same convention Trip
// History uses for its picker.
const RANGE_START = '2020-01-01'
// What a reviewed row's background becomes while a colleague's claim change is flashing.
const CLAIM_FLASH_CLASS = 'bg-sec-c/50'
type Tab = 'unreviewed' | 'mine' | 'history'

const SEVERITY_OPTIONS = [
  { value: '' as const, label: 'All severities' },
  ...(['critical', 'warning', 'info'] as const).map(value => ({ value, label: EXCEPTION_SEVERITY_META[value].label })),
]
const GROUP_OPTIONS = [{ value: 'none' as const, label: 'No grouping' }, { value: 'trip' as const, label: 'Group by trip' }]

// Time-like columns read best newest first; text columns A to Z.
const defaultDirection = (key: ExceptionSortKey): 'asc' | 'desc' => key === 'raised' ? 'desc' : 'asc'

export default function ExceptionsPage() {
  const searchParams = useSearchParams()
  const urlKey = searchParams.toString()
  const [state, setState] = useState<ExceptionListViewState>(() => parseExceptionViewState(new URLSearchParams(urlKey)))
  const { tab, q, severity, fromDate, toDate } = state
  const dates = useMemo(() => ({ fromDate, toDate }), [fromDate, toDate])
  const [rawSearch, setRawSearch] = useState(q)
  const [previousUrl, setPreviousUrl] = useState(urlKey)
  if (urlKey !== previousUrl) {
    setPreviousUrl(urlKey)
    const next = parseExceptionViewState(new URLSearchParams(urlKey))
    setState(next); setRawSearch(next.q)
  }
  const update = useCallback((patch: Partial<ExceptionListViewState>, resetPage = false): void => {
    setState(current => ({ ...current, ...patch, ...(resetPage ? { navigation: FIRST_HISTORY_PAGE } : {}) }))
  }, [])
  const query = serializeExceptionViewState(state)
  const origin = `${ROUTES.exceptions}${query ? `?${query}` : ''}`
  useEffect(() => {
    // Native history integrates with Next search params and preserves input focus.
    if (query !== urlKey) window.history.replaceState(null, '', origin)
  }, [query, urlKey, origin])
  const queue = useExceptionQueue()
  const { user, isLoading: authLoading } = useAuth()
  const meId = user?.id ?? null
  const now = useNow(CLOCK_TICK_MS)
  const claimChanges = useClaimChanges(queue.items)
  useEffect(() => {
    const timer = setTimeout(() => { if (rawSearch !== q) update({ q: rawSearch }, true) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [rawSearch, q, update])
  const filters = useMemo(() => ({ q: q || undefined, severity: severity || undefined, ...dates }), [q, severity, dates])
  const onHistoryNavigation = useCallback((navigation: ExceptionHistoryNavigationState) => update({ navigation }), [update])
  const history = useExceptionHistory(filters, { ...state.navigation, onChange: onHistoryNavigation })
  const { unreviewed, mine } = useMemo(() => {
    const ordered = sortQueueChronologically([...new Map(queue.items.map(item => [item.id, item])).values()])
    return {
      // Everything still awaiting review, whoever holds the claim: a claim says who is working an
      // exception, it does not take it out of the shared queue. "Claimed by me" is a subset view.
      unreviewed: ordered.filter(item => ['unreviewed', 'claimed_by_me', 'claimed_by_other'].includes(reviewState(item, meId).kind)),
      mine: ordered.filter(item => reviewState(item, meId).kind === 'claimed_by_me'),
    }
  }, [queue.items, meId])
  const completeTab = tab === 'mine' ? mine : unreviewed
  // History is cursor-paginated by the server in raised order, and trip groups have their own
  // order, so header sorting only applies to a flat, complete queue tab.
  const grouped = tab !== 'history' && state.group === 'trip'
  const sortable = tab !== 'history' && !grouped
  const items = tab === 'history' ? history.items : filterQueue(sortQueue(completeTab, state.sort), filters)
  const loading = tab === 'history' ? history.isLoading : queue.isLoading
  const error = tab === 'history' ? history.error : queue.error
  const hasData = tab === 'history' ? history.items.length > 0 : queue.items.length > 0
  const activeFilters = !!(q || severity || dates.fromDate || dates.toDate)
  function clearFilters(): void { setRawSearch(''); update({ q: '', severity: '', fromDate: undefined, toDate: undefined }, true) }
  function selectTab(next: Tab): void { update({ tab: next }) }
  function sortBy(columnId: string): void {
    const key = columnId as ExceptionSortKey
    update({ sort: state.sort.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDirection(key) } })
  }

  // The picker always holds a concrete range; an untouched one is stored as "no date filter" so
  // the URL, the history query and "Clear filters" keep their existing optional-date meaning.
  const today = exceptionCalendarDay(now.toISOString()) ?? RANGE_START
  const daysAgo = useCallback((days: number): string => exceptionCalendarDay(new Date(now.getTime() - days * MS_PER_DAY).toISOString()) ?? today, [now, today])
  const presets = useMemo(() => [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'Last 7 days', range: { from: daysAgo(PRESET_WEEK_DAYS), to: today } },
    { label: 'Last 30 days', range: { from: daysAgo(PRESET_MONTH_DAYS), to: today } },
  ], [today, daysAgo])
  function onDateRange(range: { from: string; to: string }): void {
    const from = range.from && range.from !== RANGE_START ? range.from : undefined
    const to = range.to && range.to !== today ? range.to : undefined
    if (from && to && from > to) return
    update({ fromDate: from, toDate: to }, true)
  }

  const tabItems: TabItem[] = [
    { id: 'unreviewed', label: 'Unreviewed', badge: queue.isLoading ? undefined : unreviewed.length, badgeUrgent: true },
    { id: 'mine', label: 'Claimed by me', badge: queue.isLoading ? undefined : mine.length },
    { id: 'history', label: 'History' },
  ]
  const empty = activeFilters ? (tab === 'history' ? 'No history matches these filters.' : 'No exceptions match these filters.')
    : tab === 'mine' ? 'Nothing claimed by you.' : tab === 'history' ? 'No exception history yet.' : 'No exceptions need review.'

  const container = useRef<HTMLDivElement | null>(null)
  const setScroller = useCallback((el: HTMLDivElement | null): void => { container.current = el }, [])
  const restoration = useExceptionListRestoration(meId, origin, container, !loading && !error, authLoading !== true)
  const { save: saveForRestoration, expanded, setExpanded } = restoration

  const columns = useMemo(() => buildExceptionColumns({
    meId, now, hrefFor: id => withReturnTo(ROUTES.exceptionDetail(id), origin), onOpen: saveForRestoration,
  }), [meId, now, origin, saveForRestoration])

  const groups: TableGroup<TripExceptionListItem>[] | undefined = useMemo(() => grouped
    ? groupQueueByTrip(items).map((group: ExceptionTripGroup) => {
      const open = expanded[group.tripId] ?? group.severityCounts.critical > 0
      return {
        id: group.tripId, rows: group.items, collapsed: !open,
        header: (bodyId: string) => (
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setExpanded(current => ({ ...current, [group.tripId]: !open }))}
            className="flex min-h-11 w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sec">
            <span className="min-w-0"><span className="block break-all text-sm font-semibold tabular-nums">Trip {group.tripReference}</span><span className="mt-1 block text-xs text-on-surf-v">{group.severityCounts.critical} critical · {group.severityCounts.warning} warning · {group.severityCounts.info} info · {group.unreviewedCount} unreviewed · {group.claimCount} claimed</span></span>
            <span className="text-xs leading-5 text-on-surf-v tabular-nums"><span className="block">Newest · {fmtExceptionRaised(group.newestRaised ?? '')}</span><span className="block">Oldest · {fmtExceptionRaised(group.oldestRaised ?? '')}</span><span className="block text-sec">{open ? 'Collapse' : 'Expand'}</span></span>
          </button>
        ),
      }
    })
    : undefined, [grouped, items, expanded, setExpanded])

  // Skeleton rows only for the very first load. Once data exists, a refetch (including a live claim
  // update) swaps rows in place, so nothing flashes.
  const initialLoad = loading && !hasData
  const showResults = !initialLoad && !(error && !hasData)
  const refetch = tab === 'history' ? history.refetch : queue.refetch
  const cardTitle = tab === 'history' ? 'Exception history' : tab === 'mine' ? 'Claimed by me' : 'Unreviewed exceptions'

  return <div className="flex flex-1 min-h-0 flex-col">
    <TopBar title="Exceptions" sub={queue.isLoading ? 'Loading exceptions…' : queue.error && !queue.items.length ? 'Queue unavailable' : `${queue.items.length} needing review`} />
    {/* Tabs size to their labels: a fixed max width cut "Claimed by me" down to "Claimed by…". */}
    <div className="px-6 pt-4"><Tabs tabs={tabItems} active={tab} onChange={id => selectTab(id as Tab)} panelId="exception-results" ariaLabel="Exception views" className="w-fit [&>button]:flex-none" /></div>
    <ListToolbar hasActiveFilters={activeFilters} onClear={clearFilters}>
      <SearchField value={rawSearch} onChange={setRawSearch} placeholder="Search description or trip reference…" ariaLabel="Search description or trip reference" />
      <FilterSelect value={severity} onChange={(value: '' | ExceptionSeverity) => update({ severity: value }, true)} options={SEVERITY_OPTIONS} ariaLabel="Severity" />
      <DateRangePicker value={{ from: fromDate ?? RANGE_START, to: toDate ?? today }} onChange={onDateRange} presets={presets} />
      {tab !== 'history' && <FilterSelect value={state.group} onChange={group => update({ group })} options={GROUP_OPTIONS} ariaLabel="Group by" />}
    </ListToolbar>
    {/* A colleague's claim change is announced politely: it matters, but never interrupts typing. */}
    <p role="status" aria-live="polite" className="sr-only">{claimChanges.announcement}</p>
    {(error || (tab === 'history' && history.isStale)) && hasData && <div role="status" className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warn-c px-5 py-3 text-sm text-warn-onc">This list may be out of date, the last refresh failed.<Button size="sm" variant="ghost" onClick={refetch}>Retry</Button></div>}

    <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surf-lowest shadow-level-3" id="exception-results" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {/* The count lives in the title bar rather than a row of its own. It stays a heading so a
          restored list has somewhere to put focus, and a live region so a refetch is announced. */}
      <SecHead title={cardTitle} meta={showResults && <h2 tabIndex={-1} data-results-heading aria-live="polite" className="text-[11px] font-semibold tracking-normal text-on-surf-v">{tab === 'history' ? `${history.totalItems} matching records` : `Showing ${items.length} of ${completeTab.length}`}</h2>} />
      {error && !hasData ? <div role="alert" className="p-6"><h2 className="text-lg font-semibold">Could not load {tab === 'history' ? 'exception history' : 'exceptions'}</h2><p className="my-3 text-sm">{error}</p><Button onClick={refetch}>Retry</Button>{tab === 'history' && history.hasPrevious && <Button variant="ghost" onClick={clearFilters}>Return to first page</Button>}</div>
          : <>
            {items.length || initialLoad ? <Table<TripExceptionListItem>
              tableId={EXCEPTION_TABLE_ID}
              caption={cardTitle}
              isLoading={initialLoad}
              loadingLabel={tab === 'history' ? 'Loading exception history' : 'Loading exceptions'}
              columns={columns}
              rows={grouped ? undefined : items}
              groups={groups}
              getRowKey={item => item.id}
              rowClassName={item => claimChanges.highlighted.has(item.id) ? `${CLAIM_FLASH_CLASS} transition-colors` : undefined}
              sort={sortable ? { id: state.sort.key, dir: state.sort.dir } : undefined}
              onSort={sortable ? sortBy : undefined}
              onScroller={setScroller}
              className="min-h-0 flex-1"
            />
              : <div className="p-6"><p className="text-sm">{empty}</p>{activeFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}{tab === 'mine' && !activeFilters && <Button variant="ghost" onClick={() => selectTab('unreviewed')}>Go to Unreviewed</Button>}</div>}
            {tab === 'history' && !initialLoad && <div className="shrink-0 border-t border-outline-v/10 px-5 py-2"><Pagination page={history.page} pageSize={history.pageSize} itemCount={items.length} totalItems={history.totalItems} hasPrevious={history.hasPrevious} hasNext={history.hasNext} isLoading={loading} onPrevious={history.goToPreviousPage} onNext={history.goToNextPage} /></div>}
          </>}
    </div>
  </div>
}
