'use client'

import { Card } from '@/components/ui/Card'
import { InfoRowsSkeleton } from '@/components/ui/DetailSkeleton'
import { Skeleton, SkeletonBar } from '@/components/ui/Skeleton'
import { PRECINCT_GRID_CLASSES } from '@/components/precincts/PrecinctCard'

const SKELETON_CARDS = 6
const CARD_INFO_ROWS = 3
/** A PrecinctCard's own structure with the content left blank: the map band bleeding to the card
 *  edges, then the name, address and fact panel. */
export function PrecinctCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3 overflow-hidden p-0">
      <Skeleton className="h-[150px] w-full rounded-none" />
      <div className="flex flex-col gap-3 p-5 pt-0">
        <div className="flex min-h-[22.5px] items-center gap-2">
          <SkeletonBar className="h-4 w-4" />
          <SkeletonBar className="h-4 w-40" />
        </div>
        <div className="mt-[2px] flex h-[16.5px] items-center">
          <SkeletonBar className="h-2.5 w-4/5" />
        </div>
        <InfoRowsSkeleton rows={CARD_INFO_ROWS} className="rounded-lg bg-surf-low p-[10px_12px]" />
      </div>
    </Card>
  )
}

export function PrecinctCardGridSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading precincts" className={PRECINCT_GRID_CLASSES}>
      {Array.from({ length: SKELETON_CARDS }, (_, index) => <PrecinctCardSkeleton key={index} />)}
    </div>
  )
}
