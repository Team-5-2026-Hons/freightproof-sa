'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { TopBar }           from '@/components/ui/TopBar'
import { SecHead }          from '@/components/ui/SecHead'
import { Button }           from '@/components/ui/Button'
import { Spinner }          from '@/components/ui/Spinner'
import { Ic }               from '@/components/ui/Ic'
import { EmptyState }       from '@/components/ui/EmptyState'
import { DateRangePicker }  from '@/components/ui/DateRangePicker'
import { Pagination }       from '@/components/ui/Pagination'
import { ChecklistRow }     from '@/components/domain/ChecklistRow'
import type { ColWidths }   from '@/components/domain/ChecklistRow'
import { useTripHistory }   from '@/lib/hooks/useTripHistory'
import { putTripSeeds }     from '@/lib/trips/tripSeed'
import { usePrecincts }     from '@/lib/hooks/usePrecincts'
import { useToast }         from '@/lib/hooks/useToast'
import { COPY }             from '@shared/lib/constants/copy'
import type { DateRange }   from '@/lib/types/date-range'

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

type ColId = keyof ColWidths

const COL_HEADERS: { id: ColId; label: string }[] = [
  { id: 'createdAt', label: 'CLOSED'         },
  { id: 'tripId',    label: 'TRIP ID'        },
  { id: 'order',     label: 'ORDER'          },
  { id: 'driver',    label: 'DRIVER / HORSE' },
  { id: 'route',     label: 'ROUTE'          },
  { id: 'progress',  label: 'EXCEPTIONS'     },
  { id: 'status',    label: 'STATUS'         },
]

const INITIAL_COL_WIDTHS: ColWidths = {
  createdAt: 60,
  tripId:    242,
  order:     155,
  driver:    150,
  route:     130,
  progress:  160,
  status:    120,
}

const MIN_COL_W = 80

export default function HistoryPage() {
  const [search, setSearch]       = useState('')
  const [dateRange, setDateRange] = useState<DateRange>({ from: HISTORY_RANGE_START, to: todayStr() })
  const [precinctId, setPrecinctId] = useState('')
  const [colWidths, setColWidths] = useState<ColWidths>(INITIAL_COL_WIDTHS)
  const resizeRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null)
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

  function startResize(id: ColId, e: React.MouseEvent) {
    e.preventDefault()
    resizeRef.current = { id, startX: e.clientX, startW: colWidths[id] }

    function onMove(ev: MouseEvent) {
      const r = resizeRef.current
      if (!r) return
      setColWidths(p => ({ ...p, [r.id]: Math.max(MIN_COL_W, r.startW + (ev.clientX - r.startX)) }))
    }

    function onUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Trip History" sub={`${history.totalItems} closed trips`} />

      {/* Search + filters */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          />
        </div>

        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <div className="relative shrink-0">
          <select
            value={precinctId}
            onChange={e => setPrecinctId(e.target.value)}
            className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          >
            <option value="">All routes</option>
            {precincts.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
        </div>
      </div>

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

        {/* Table scroll area — x+y scroll together */}
        <div className="flex-1 overflow-auto">
          {history.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : history.error && history.items.length === 0 ? (
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
          ) : (
            <div className="min-w-[700px]">

              {/* Sticky column header — drag right edge handle to resize */}
              <div className="sticky top-0 flex px-6 py-[7px] bg-surf-low border-b border-outline-v/10 divide-x divide-outline/30 select-none">
                {COL_HEADERS.map(col => {
                  // Symmetric padding (rather than a flex gap) keeps the divider
                  // line centred between columns instead of flush against text.
                  const padCls = col.id === 'createdAt' ? 'pr-[6px]' : col.id === 'status' ? 'pl-[6px]' : 'px-[6px]'
                  return (
                    <div
                      key={col.id}
                      style={{ width: colWidths[col.id], flexShrink: 0 }}
                      className={`relative group ${padCls} text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v`}
                    >
                      {col.label}
                      {/* Resize handle — hover to reveal, drag to resize */}
                      <div
                        onMouseDown={e => startResize(col.id, e)}
                        className="absolute right-0 top-0 h-full w-4 cursor-col-resize flex items-center justify-center"
                      >
                        <div className="w-[2px] h-3 rounded-full bg-outline-v/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Rows */}
              <div className="divide-y divide-outline-v/10">
                {history.items.length === 0 && !hasNarrowedFilters ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<Ic n="clock" s={32} className="text-on-surf-v" />}
                      title="No trip history"
                      body="Closed trips will appear here."
                    />
                  </div>
                ) : history.items.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                      title={COPY.emptyState.noResults.title}
                      body={COPY.emptyState.noResults.body}
                    />
                  </div>
                ) : (
                  history.items.map(trip => (
                    <ChecklistRow
                      key={trip.id}
                      // ChecklistRow's first cell is its generic row date. On this
                      // terminal-only screen that date is closed_at, never updated_at.
                      trip={{ ...trip, created_at: trip.closed_at }}
                      colWidths={colWidths}
                      precincts={precincts}
                      showProgress={false}
                    />
                  ))
                )}
              </div>

            </div>
          )}
        </div>

        {!history.isLoading && !(history.error && history.items.length === 0) && (
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
