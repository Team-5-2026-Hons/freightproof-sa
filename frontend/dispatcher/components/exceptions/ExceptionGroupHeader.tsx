'use client'

import { fmtExceptionRaised } from '@/lib/format/exception'
import type { ExceptionTripGroup } from '@/lib/exceptions/queue'

export interface ExceptionGroupHeaderProps {
  group: ExceptionTripGroup
  open: boolean
  /** Id of the body this header controls, for `aria-controls`. */
  bodyId: string
  onToggle: () => void
}

/** The full-width header row of one trip's exceptions: counts on the left, raised range on the right. */
export function ExceptionGroupHeader({ group, open, bodyId, onToggle }: ExceptionGroupHeaderProps): React.JSX.Element {
  const { severityCounts } = group

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={onToggle}
      className="flex min-h-11 w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sec"
    >
      <span className="min-w-0">
        <span className="block break-all text-sm font-semibold tabular-nums">Trip {group.tripReference}</span>
        <span className="mt-1 block text-xs text-on-surf-v">
          {severityCounts.critical} critical · {severityCounts.warning} warning · {severityCounts.info} info
          · {group.unreviewedCount} unreviewed · {group.claimCount} claimed
        </span>
      </span>
      <span className="text-xs leading-5 text-on-surf-v tabular-nums">
        <span className="block">Newest · {fmtExceptionRaised(group.newestRaised ?? '')}</span>
        <span className="block">Oldest · {fmtExceptionRaised(group.oldestRaised ?? '')}</span>
        <span className="block text-sec">{open ? 'Collapse' : 'Expand'}</span>
      </span>
    </button>
  )
}
