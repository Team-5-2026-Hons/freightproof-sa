'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }          from '@/components/ui/TopBar'
import { SecHead }         from '@/components/ui/SecHead'
import { Chip }            from '@/components/ui/Chip'
import { Ic }              from '@/components/ui/Ic'
import { EmptyState }      from '@/components/ui/EmptyState'
import { Spinner }         from '@/components/ui/Spinner'
import { Button }          from '@/components/ui/Button'
import { Pagination }      from '@/components/ui/Pagination'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { useExceptionQueue }   from '@/lib/hooks/useExceptions'
import { useExceptionHistory } from '@/lib/hooks/useExceptionHistory'
import type { UseExceptionQueueResult } from '@/lib/hooks/useExceptions'
import type { UseExceptionHistoryResult, ExceptionHistoryFilters } from '@/lib/hooks/useExceptionHistory'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META, TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ChipType } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'
import { cn }     from '@shared/lib/utils/cn'
import type {
  TripExceptionListItem,
  ExceptionSeverity,
  ExceptionReviewStatus,
} from '@shared/lib/types/exception'
import type { DateRange } from '@/lib/types/date-range'

// Wide sentinel range predating the platform — same precedent as Trip History's own
// HISTORY_RANGE_START (app/(app)/history/page.tsx). useExceptionHistory has no "no date
// filter" state of its own, so the picker always sends a concrete {from, to} and this is
// simply wide enough that it never narrows a real query.
const HISTORY_RANGE_START = '2020-01-01'

// A dispatcher typing a search term should see their own keystrokes immediately, but
// forwarding every keystroke as a fresh server query would fire a request per character.
// This is the settle time before a typed value becomes a real filter.
const SEARCH_DEBOUNCE_MS = 300

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

// Builds "In Transit · Stop 2" from whichever of the two the row actually has. Returns
// null (never the literal string "null" or a dangling "· ") when both are absent, so the
// caller can render it directly without a broken fragment showing up on screen.
function phaseStopLabel(phaseLabel: string | null, stopLabel: number | null): string | null {
  const parts: string[] = []
  if (phaseLabel) parts.push(phaseLabel)
  if (stopLabel !== null) parts.push(`Stop ${stopLabel}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// Local to this file, deliberately — there is no shared meta for the review-status
// badge (recorded vs reviewed) because nothing outside the History tab needs it yet.
function reviewStatusMeta(status: ExceptionReviewStatus): { label: string; chipType: ChipType } {
  switch (status) {
    case 'reviewed': return { label: 'Reviewed', chipType: 'complete' }
    case 'recorded': return { label: 'Recorded', chipType: 'pending' }
    // The history endpoint never actually returns needs_review rows, but the field's
    // type is the full ExceptionReviewStatus union (see useExceptionHistory.ts) —
    // this branch exists so the switch stays exhaustive rather than needing a cast.
    default: return { label: 'Needs Review', chipType: 'exception' }
  }
}

// Left-border accent per severity — draws the eye to high-priority items
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-4 border-err',
  warning:  'border-l-4 border-warn',
  info:     'border-l-4 border-outline-v/30',
}

type Tab = 'queue' | 'history'

export default function ExceptionsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('queue')

  const queue = useExceptionQueue()

  // History filters are this tab's own local UI state, translated into
  // ExceptionHistoryFilters below and handed to the hook every render — the hook itself
  // resets to page 1 when the derived filter values change, so this file never has to.
  const [rawSearch, setRawSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'' | ExceptionReviewStatus>('')
  const [severity, setSeverity] = useState<'' | ExceptionSeverity>('')
  const [dateRange, setDateRange] = useState<DateRange>({ from: HISTORY_RANGE_START, to: todayStr() })

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(rawSearch), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [rawSearch])

  const filters: ExceptionHistoryFilters = useMemo(() => ({
    q: debouncedSearch || undefined,
    reviewStatus: reviewStatus || undefined,
    severity: severity || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to,
  }), [debouncedSearch, reviewStatus, severity, dateRange])

  const history = useExceptionHistory(filters)

  function goToDetail(id: string) {
    router.push(ROUTES.exceptionDetail(id))
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Exceptions"
        sub={`${queue.items.length} needing review · ${history.totalItems} in history`}
      />

      {/* Underline tab toggle */}
      <div className="flex px-6 pt-5 shrink-0">
        <button
          onClick={() => setTab('queue')}
          className={cn(
            'px-4 pb-3 text-[13px] font-[600] border-b-2 transition-colors duration-150',
            tab === 'queue'
              ? 'border-sec text-sec'
              : 'border-transparent text-on-surf-v hover:text-on-surf',
          )}
        >
          Needs Review
          {queue.items.length > 0 && (
            <span className="ml-1.5 bg-err text-white text-[10px] font-[700] rounded-sm px-[5px] py-[1px]">
              {queue.items.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('history')}
          className={cn(
            'px-4 pb-3 text-[13px] font-[600] border-b-2 transition-colors duration-150',
            tab === 'history'
              ? 'border-sec text-sec'
              : 'border-transparent text-on-surf-v hover:text-on-surf',
          )}
        >
          History
        </button>
        {/* Underline fills remaining width */}
        <div className="flex-1 border-b-2 border-outline-v/20" />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'queue' ? (
          <QueueTab queue={queue} onRowClick={goToDetail} />
        ) : (
          <HistoryTab
            history={history}
            rawSearch={rawSearch}
            onSearchChange={setRawSearch}
            reviewStatus={reviewStatus}
            onReviewStatusChange={setReviewStatus}
            severity={severity}
            onSeverityChange={setSeverity}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onRowClick={goToDetail}
          />
        )}
      </div>
    </div>
  )
}

// ─── Shared row + banner ──────────────────────────────────────────────────────

interface ExceptionRowProps {
  item: TripExceptionListItem
  onClick: () => void
  /** History-only review-status badge — omitted entirely on the Needs Review tab. */
  trailing?: React.ReactNode
}

function ExceptionRow({ item, onClick, trailing }: ExceptionRowProps) {
  const sevMeta = EXCEPTION_SEVERITY_META[item.severity]
  const srcMeta = EXCEPTION_SOURCE_META[item.source]
  const statusMeta = TRIP_STATUS_META[item.trip_status]
  const phaseStop = phaseStopLabel(item.phase_label, item.stop_label)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      className={cn(
        'flex items-center gap-4 px-6 py-[14px] cursor-pointer',
        'bg-surf-lowest transition-colors duration-[120ms] hover:bg-surf-low',
        SEVERITY_BORDER[item.severity],
      )}
    >
      {/* Severity */}
      <div className="w-[80px] shrink-0">
        <Chip type={sevMeta.chipType} label={sevMeta.label} />
      </div>

      {/* Type + source */}
      <div className="w-[170px] shrink-0 min-w-0">
        <div className="text-[13px] font-[700] text-on-surf leading-tight truncate">
          {fmtType(item.exception_type)}
        </div>
        <div className="text-[11px] text-on-surf-v mt-[2px]">
          {srcMeta.label}
        </div>
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-on-surf-v truncate">{item.description}</p>
      </div>

      {/* Trip ref */}
      <div className="w-[100px] shrink-0 text-[12px] font-[600] text-sec tabular-nums tracking-[0.04em] truncate">
        {item.trip_reference}
      </div>

      {/* Trip lifecycle status — new: lets a dispatcher see a critical exception sitting
          on a trip that is already cancelled or closed. */}
      <div className="w-[100px] shrink-0">
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
      </div>

      {/* Phase / stop context */}
      <div className="w-[150px] shrink-0 text-[11px] text-on-surf-v truncate">
        {phaseStop}
      </div>

      {/* Timestamp */}
      <div className="w-[100px] shrink-0 flex items-center gap-1 text-[11px] font-[500] text-sec tabular-nums">
        <Ic n="clock" s={10} className="text-sec shrink-0" />
        {fmtTs(item.created_at)}
      </div>

      {trailing && <div className="w-[100px] shrink-0">{trailing}</div>}

      {/* View */}
      <div className="w-[48px] shrink-0 flex justify-end">
        <span className="flex items-center gap-0.5 text-[12px] font-[600] text-sec">
          View <Ic n="chev" s={13} className="text-sec" />
        </span>
      </div>
    </div>
  )
}

/** Shown above the list when the last refresh failed but earlier rows are still on
 * screen — identical in spirit to the old page's single banner, now shared by both
 * tabs since each has its own notion of "the last refresh failed". */
function StaleBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-warn-c px-5 py-3">
      <div className="flex items-center gap-[9px]">
        <Ic n="warn" s={14} className="text-warn-onc shrink-0" />
        <span className="text-[12px] font-[600] text-warn-onc">
          This list may be out of date — the last refresh failed.
        </span>
      </div>
      <Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button>
    </div>
  )
}

// ─── Needs Review tab ─────────────────────────────────────────────────────────

interface QueueTabProps {
  queue: UseExceptionQueueResult
  onRowClick: (id: string) => void
}

function QueueTab({ queue, onRowClick }: QueueTabProps) {
  const { items, isLoading, error, refetch } = queue

  return (
    <div className="mx-6 my-5">
      {/* A background refresh failed while rows were already on screen — the list below
          is still real data, just possibly stale, so it stays up with a warning rather
          than being replaced by an error page. */}
      {error && items.length > 0 && <StaleBanner onRetry={refetch} />}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error && items.length === 0 ? (
        /* Ranked ahead of the all-clear empty state deliberately: "no exceptions" is the
           most reassuring thing this screen can say, and saying it because a fetch
           failed would be the worst error this page could make. */
        <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-err" />}
            title="Could not load exceptions"
            body={error}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
          <EmptyState
            icon={<Ic n="check" s={32} className="text-on-surf-v" />}
            title={COPY.emptyState.allClear.title}
            body={COPY.emptyState.allClear.body}
          />
        </div>
      ) : (
        <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
          <SecHead title="Needs Review" />

          <div className="flex items-center gap-4 px-6 py-[7px] bg-surf-low border-b border-outline-v/10 select-none">
            <div className="w-[80px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Severity</div>
            <div className="w-[170px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Type · Source</div>
            <div className="flex-1 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Description</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Trip</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Trip Status</div>
            <div className="w-[150px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Phase / Stop</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Raised</div>
            <div className="w-[48px] shrink-0" />
          </div>

          <div className="divide-y divide-outline-v/10">
            {items.map(item => (
              <ExceptionRow key={item.id} item={item} onClick={() => onRowClick(item.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

interface HistoryTabProps {
  history: UseExceptionHistoryResult
  rawSearch: string
  onSearchChange: (value: string) => void
  reviewStatus: '' | ExceptionReviewStatus
  onReviewStatusChange: (value: '' | ExceptionReviewStatus) => void
  severity: '' | ExceptionSeverity
  onSeverityChange: (value: '' | ExceptionSeverity) => void
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  onRowClick: (id: string) => void
}

function HistoryTab({
  history,
  rawSearch, onSearchChange,
  reviewStatus, onReviewStatusChange,
  severity, onSeverityChange,
  dateRange, onDateRangeChange,
  onRowClick,
}: HistoryTabProps) {
  const {
    items, isLoading, error, isStale, totalItems,
    page, pageSize, hasPrevious, hasNext, goToNextPage, goToPreviousPage, refetch,
  } = history

  return (
    <div className="mx-6 my-5">
      {/* Filter bar — mirrors Trip History's own filter-bar conventions (plain inline
          input/selects, DateRangePicker) rather than the boxed Input/Select components. */}
      <div className="flex items-center gap-3 pb-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search description or trip reference…"
            value={rawSearch}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          />
        </div>

        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />

        <div className="relative shrink-0">
          <select
            value={reviewStatus}
            onChange={e => onReviewStatusChange(e.target.value as '' | ExceptionReviewStatus)}
            className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          >
            <option value="">All statuses</option>
            <option value="recorded">Recorded</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
        </div>

        <div className="relative shrink-0">
          <select
            value={severity}
            onChange={e => onSeverityChange(e.target.value as '' | ExceptionSeverity)}
            className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          >
            <option value="">All severities</option>
            <option value="info">{EXCEPTION_SEVERITY_META.info.label}</option>
            <option value="warning">{EXCEPTION_SEVERITY_META.warning.label}</option>
            <option value="critical">{EXCEPTION_SEVERITY_META.critical.label}</option>
          </select>
          <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
        </div>
      </div>

      {/* A page-turn or background refresh failed while a previous page's rows were
          still on screen — the hook's own isStale flag exists precisely for this,
          rather than reusing Needs Review's `error && items.length > 0` shape. */}
      {isStale && items.length > 0 && <StaleBanner onRetry={refetch} />}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error && items.length === 0 ? (
        <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-err" />}
            title="Could not load exception history"
            body={error}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
          />
        </div>
      ) : items.length === 0 ? (
        // Reused for both "no history at all" and "no history matching these filters":
        // a dispatcher browsing an archive with zero rows on either page 1 with wide-
        // open filters or a narrow filter reads the same way — nothing to show right now.
        <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
          <EmptyState
            icon={<Ic n="search" s={32} className="text-on-surf-v" />}
            title={COPY.emptyState.noResults.title}
            body={COPY.emptyState.noResults.body}
          />
        </div>
      ) : (
        <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
          <SecHead title="Exception History" />

          <div className="flex items-center gap-4 px-6 py-[7px] bg-surf-low border-b border-outline-v/10 select-none">
            <div className="w-[80px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Severity</div>
            <div className="w-[170px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Type · Source</div>
            <div className="flex-1 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Description</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Trip</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Trip Status</div>
            <div className="w-[150px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Phase / Stop</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Raised</div>
            <div className="w-[100px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Review</div>
            <div className="w-[48px] shrink-0" />
          </div>

          <div className="divide-y divide-outline-v/10">
            {items.map(item => {
              const rMeta = reviewStatusMeta(item.review_status)
              return (
                <ExceptionRow
                  key={item.id}
                  item={item}
                  onClick={() => onRowClick(item.id)}
                  trailing={<Chip type={rMeta.chipType} label={rMeta.label} />}
                />
              )
            })}
          </div>

          <div className="px-5 border-t border-outline-v/10">
            <Pagination
              page={page}
              pageSize={pageSize}
              itemCount={items.length}
              totalItems={totalItems}
              hasPrevious={hasPrevious}
              hasNext={hasNext}
              isLoading={isLoading}
              onPrevious={goToPreviousPage}
              onNext={goToNextPage}
            />
          </div>
        </div>
      )}
    </div>
  )
}
