'use client'

import { Card } from '@/components/ui/Card'
import { InfoRowsSkeleton } from '@/components/ui/DetailSkeleton'
import { SkeletonBar } from '@/components/ui/Skeleton'
import { VEHICLE_GRID_CLASSES } from '@/components/vehicles/VehicleCard'

const SKELETON_CARDS = 8
const CARD_INFO_ROWS = 4

/** A VehicleCard's own structure with the content left blank: same container, header, subtitle
 *  and fact panel, so a card is the same height whether it is loading or loaded. */
export function VehicleCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex min-h-[22.5px] items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-4 w-4" />
          <SkeletonBar className="h-4 w-28" />
        </div>
        <SkeletonBar className="h-[22px] w-14 rounded-md" />
      </div>
      <div className="mt-[2px] flex h-[16.5px] items-center">
        <SkeletonBar className="h-2.5 w-3/5" />
      </div>
      <InfoRowsSkeleton rows={CARD_INFO_ROWS} className="rounded-lg bg-surf-low p-[10px_12px]" />
    </Card>
  )
}

export function VehicleCardGridSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading vehicles" className={VEHICLE_GRID_CLASSES}>
      {Array.from({ length: SKELETON_CARDS }, (_, index) => <VehicleCardSkeleton key={index} />)}
    </div>
  )
}
