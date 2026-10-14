'use client'

import { Skeleton, SkeletonBar } from '@/components/ui/Skeleton'
import { DETAIL_PANEL_DEFAULT_W } from '@/lib/hooks/useResizablePanel'
import { cn } from '@shared/lib/utils/cn'

// Value bars vary in width so a column of them reads as rows of different data rather than one
// repeated bar. Deterministic (by index), so a skeleton never changes between renders.
const VALUE_WIDTHS = ['w-28', 'w-20', 'w-32', 'w-24', 'w-16'] as const
const DEFAULT_INFO_ROWS = 8
const DEFAULT_TIMELINE_ITEMS = 3

/** Label and value placeholders in InfoRow's own rhythm (same padding, same divider), so a panel of
 *  them is as tall as the panel it stands in for. Shows no values: every one is still in flight. */
export function InfoRowsSkeleton({ rows = DEFAULT_INFO_ROWS, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: rows }, (_, index) => (
        // InfoRow's own height, measured in the browser: 36.5px, or 35.5px for the last row, which
        // has no divider.
        <div key={index} className="flex min-h-[36.5px] items-center justify-between gap-3 border-b border-outline-v/20 last:min-h-[35.5px] last:border-0">
          <SkeletonBar className="h-2.5 w-20" />
          <SkeletonBar className={cn('h-3', VALUE_WIDTHS[index % VALUE_WIDTHS.length])} />
        </div>
      ))}
    </div>
  )
}

/** The tab switcher above a history panel. */
export function TabsSkeleton() {
  return (
    <div aria-hidden className="mb-4 flex gap-2">
      {/* 41px: the real tab bar's height, measured in the browser, so the content below starts at the same place. */}
      <Skeleton className="h-[41px] w-28 rounded-md" />
      <Skeleton className="h-[41px] w-24 rounded-md" />
    </div>
  )
}

/** Event cards as EventTimeline draws them: a title and timestamp row, then a change line. */
export function TimelineSkeleton({ items = DEFAULT_TIMELINE_ITEMS }: { items?: number }) {
  return (
    <ol aria-hidden className="space-y-[8px]">
      {Array.from({ length: items }, (_, index) => (
        <li key={index} className="rounded-lg bg-surf-low p-[12px_14px]">
          <div className="flex items-start justify-between gap-3">
            <SkeletonBar className="h-3.5 w-40" />
            <SkeletonBar className="h-3 w-32" />
          </div>
          <div className="mt-[8px] flex items-center justify-between gap-3">
            <SkeletonBar className="h-2.5 w-20" />
            <SkeletonBar className="h-2.5 w-28" />
          </div>
        </li>
      ))}
    </ol>
  )
}

interface SplitDetailSkeletonProps {
  /** Announced to screen readers, e.g. "Loading vehicle". */
  label: string
  infoRows?: number
}

/** The vehicle and driver detail layout while the record loads: an info column at its default
 *  width beside a tabbed history. Same blocks as the finished page, so nothing jumps when it lands. */
export function SplitDetailSkeleton({ label, infoRows }: SplitDetailSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-1 overflow-hidden">
      <div style={{ width: DETAIL_PANEL_DEFAULT_W }} className="shrink-0 overflow-hidden border-r border-outline-v/20 bg-surf-low p-5">
        <SkeletonBar className="mb-3 h-3 w-24" />
        <InfoRowsSkeleton rows={infoRows} />
      </div>
      <div className="flex-1 overflow-hidden bg-surf-lowest p-6">
        <TabsSkeleton />
        <TimelineSkeleton />
      </div>
    </div>
  )
}
