'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { SkeletonBar } from '@/components/ui/Skeleton'
import { Table, type TableColumn } from '@/components/ui/Table'
import { DashboardPanel } from '@/components/dashboard/DashboardPanel'
import { RefreshFailedNote } from '@/components/dashboard/RefreshFailedNote'
import { ROUTES } from '@/lib/constants/routes'
import { exceptionsNeedingAttention, PANEL_ROW_LIMIT } from '@/lib/dashboard/attention'
import { exceptionReference, fmtExceptionRaised, fmtExceptionType } from '@/lib/format/exception'
import { fmtAge } from '@/lib/format/period'
import { useExceptionQueue } from '@/lib/hooks/useExceptions'
import { useLastLoadedAt } from '@/lib/hooks/useLastLoadedAt'
import { useNow } from '@/lib/hooks/useNow'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

const TABLE_ID = 'dashboard-exceptions'
// Skeleton rows match what the panel will hold, so it does not change height when data arrives.
const SKELETON_ROWS = PANEL_ROW_LIMIT
// Ages stay honest without a new event to re-render them.
const CLOCK_TICK_MS = 60_000
// Panel width below which the age column folds away rather than the table scrolling sideways.
const RAISED_HIDE_BELOW_PX = 480

// Single-line rows: five of them have to fit the panel without it scrolling, and the panel is half
// the page. Route, driver and the exception's description are one click away on its own page.
function buildColumns(now: Date): TableColumn<TripExceptionListItem>[] {
  return [
    {
      id: 'raised', label: 'Raised', width: 83, minWidth: 80, hideBelow: RAISED_HIDE_BELOW_PX,
      render: item => (
        // The exact time stays available on hover; the cell reads as how long it has been waiting.
        <span className="whitespace-nowrap tabular-nums text-on-surf-v" title={fmtExceptionRaised(item.created_at)}>
          {Number.isFinite(Date.parse(item.created_at)) ? `${fmtAge(item.created_at, now)} ago` : '—'}
        </span>
      ),
    },
    {
      id: 'incident', label: 'Exception', width: 262, minWidth: 170,
      // Chip-sized, so placeholder rows are as tall as real ones.
      skeleton: <div className="flex items-center gap-2"><SkeletonBar className="h-6 w-16 rounded-md" /><SkeletonBar className="h-3 w-28" /></div>,
      render: item => {
        const severity = EXCEPTION_SEVERITY_META[item.severity]
        const title = fmtExceptionType(item.exception_type)
        return (
          <div className="flex items-center gap-2">
            <Chip type={severity.chipType} label={severity.label} />
            {/* The row's one link; its ::after covers the <tr> (as in the Exceptions queue) so the whole row opens it. */}
            <Link
              href={withReturnTo(ROUTES.exceptionDetail(item.id), ROUTES.home)}
              aria-label={`${title} · ${exceptionReference(item.id)} · ${item.trip_reference}`}
              title={title}
              className="min-w-0 truncate font-semibold text-on-surf after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-sec"
            >
              {title}
            </Link>
          </div>
        )
      },
    },
    {
      id: 'trip', label: 'Trip', width: 185, minWidth: 170,
      render: item => <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-on-surf">{item.trip_reference}</span>,
    },
  ]
}

/** The dashboard's Exceptions panel: the few exceptions that most need a dispatcher, with how many
 *  are waiting in total. The review queue itself lives on the Exceptions page. */
export function DashboardExceptionsPanel(): React.JSX.Element {
  const queue = useExceptionQueue()
  const now = useNow(CLOCK_TICK_MS)
  const columns = useMemo(() => buildColumns(now), [now])
  const waiting = useMemo(() => exceptionsNeedingAttention(queue.items), [queue.items])

  // Skeleton only on the first load: a live refetch swaps rows in place.
  const initialLoad = queue.isLoading && queue.items.length === 0
  const loadFailed = !!queue.error && queue.items.length === 0
  // Old rows stay up through a failed refresh, but say so, as the Incidents panel does.
  const refreshFailed = !!queue.error && queue.items.length > 0
  const loadedAt = useLastLoadedAt(queue.items)

  return (
    <DashboardPanel
      title="Exceptions"
      count={initialLoad || loadFailed ? null : `${waiting.length} ${waiting.length === 1 ? 'needs' : 'need'} review`}
      noun="exceptions"
      viewAllHref={ROUTES.exceptions}
      help="exceptions"
    >
      {refreshFailed && <RefreshFailedNote loadedAt={loadedAt} onRetry={queue.refetch} />}
      {loadFailed ? (
        <EmptyState
          className="py-8"
          icon={<AlertCircle />}
          title="Failed to load exceptions"
          body={queue.error ?? ''}
          cta={<Button size="sm" variant="ghost" onClick={queue.refetch}>Try again</Button>}
        />
      ) : !initialLoad && waiting.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Ic n="check" s={32} />}
          title="Nothing to review"
          body="Every exception has been reviewed."
        />
      ) : (
        <Table<TripExceptionListItem>
          tableId={TABLE_ID}
          caption="Exceptions awaiting review"
          isLoading={initialLoad}
          loadingLabel="Loading exceptions"
          skeletonRows={SKELETON_ROWS}
          columns={columns}
          rows={waiting.slice(0, PANEL_ROW_LIMIT)}
          getRowKey={item => item.id}
          density="compact"
          className="min-h-0 flex-1"
        />
      )}
    </DashboardPanel>
  )
}
