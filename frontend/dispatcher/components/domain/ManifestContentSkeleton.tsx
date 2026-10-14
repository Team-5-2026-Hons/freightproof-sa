import { Skeleton, SkeletonBar } from '@/components/ui/Skeleton'

const SUMMARY_PLACEHOLDER_COUNT = 4
const WAYBILL_PLACEHOLDER_COUNT = 3

/** Match the narrow Cargo panel without suggesting that any counts are known yet. */
export function ManifestContentSkeleton(): React.JSX.Element {
  return (
    <div role="status" className="min-w-0 w-full">
      <span className="sr-only">Loading cargo…</span>
      {/* One announcement; the shapes are neither cargo records nor usable controls. */}
      <div aria-hidden="true" data-testid="manifest-content-skeleton" className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: SUMMARY_PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className="min-w-0 rounded-lg border border-outline-v/25 bg-surf-lowest px-3 py-2">
              <SkeletonBar className="h-3 w-2/3" />
              <SkeletonBar className="mt-2 h-4 w-1/3" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {/* An empty flex item has no intrinsic height in the stacked overlay layout. */}
          <Skeleton className="min-w-0 rounded-md sm:flex-1" />
          <Skeleton className="w-full rounded-md sm:w-32" />
        </div>

        <div className="space-y-2">
          {Array.from({ length: WAYBILL_PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} data-testid="waybill-placeholder" className="rounded-md bg-surf-lowest p-3 shadow-level-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <SkeletonBar className="h-3 w-28" />
                <SkeletonBar className="h-3 w-36" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-outline-v/20 pt-3">
          <SkeletonBar className="h-3 w-1/2" />
          <SkeletonBar className="h-7 w-16" />
        </div>
      </div>
    </div>
  )
}
