'use client'

import { InfoRowsSkeleton, TabsSkeleton, TimelineSkeleton } from '@/components/ui/DetailSkeleton'
import { Skeleton, SkeletonBar } from '@/components/ui/Skeleton'

const SIDE_COLUMN_FACTS = 5

/** The precinct detail layout while the record loads: map, tabbed history, and the fact column. */
export function PrecinctDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading precinct" className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="p-6 pb-0">
          <Skeleton className="h-[320px] w-full rounded-lg" />
        </div>
        <div className="p-6">
          <TabsSkeleton />
          <TimelineSkeleton />
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-4 border-l border-outline-v/30 bg-surf-low p-5 lg:w-[256px]">
        <SkeletonBar className="h-2.5 w-16" />
        <InfoRowsSkeleton rows={SIDE_COLUMN_FACTS} />
      </div>
    </div>
  )
}
