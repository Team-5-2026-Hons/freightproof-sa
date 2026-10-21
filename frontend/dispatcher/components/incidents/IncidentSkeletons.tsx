'use client'

import { Skeleton } from '@/components/ui/Skeleton'

const STATE_CELLS = 3
const FACT_ROWS = 6
const HISTORY_ENTRIES = 4
const SECTION_ROWS = 3

/**
 * The incident page's waiting state, in the finished layout (status strip, left column of
 * panels, right column of follow-up and history) so nothing jumps when the record lands.
 * Shows no incident facts: a placeholder must never read as recorded evidence.
 */
export function IncidentDetailSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Loading incident" className="flex-1 overflow-hidden">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 py-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: STATE_CELLS }).map((_, i) => (
            <div key={i} className="rounded-md bg-surf-low px-4 py-3">
              <Skeleton className="h-3 w-16 rounded-md" />
              <Skeleton className="mt-2 h-5 w-28 rounded-md" />
            </div>
          ))}
        </div>
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-x-6">
          <div className="flex min-w-0 flex-col gap-4">
            <PanelSkeleton>
              <Skeleton variant="text" lines={2} />
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {Array.from({ length: FACT_ROWS }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-3 w-20 rounded-md" />
                    <Skeleton className="mt-1.5 h-4 w-36 max-w-full rounded-md" />
                  </div>
                ))}
              </div>
            </PanelSkeleton>
            <PanelSkeleton><SectionRowsSkeleton /></PanelSkeleton>
            <PanelSkeleton><SectionRowsSkeleton /></PanelSkeleton>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <PanelSkeleton>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </PanelSkeleton>
            <PanelSkeleton>
              <div className="flex flex-col gap-4">
                {Array.from({ length: HISTORY_ENTRIES }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-48 max-w-full rounded-md" />
                    <Skeleton className="mt-1.5 h-3 w-32 rounded-md" />
                  </div>
                ))}
              </div>
            </PanelSkeleton>
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelSkeleton({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-outline-v/30 bg-surf-lowest">
      <div className="border-b border-outline-v/30 bg-surf-low px-4 py-[10px] sm:px-6">
        <Skeleton className="h-3 w-28 rounded-md" />
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  )
}

/** Rows for a panel body still loading (affected cargo, evidence, a trip's incident list). */
export function SectionRowsSkeleton({ rows = SECTION_ROWS, label }: { rows?: number; label?: string }): React.JSX.Element {
  return (
    <div role={label ? 'status' : undefined} aria-busy={label ? true : undefined} aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
    </div>
  )
}
