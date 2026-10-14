'use client'

import { Skeleton } from '@/components/ui/Skeleton'

const CONTEXT_FACTS = 3

/**
 * The waiting state wears the finished detail layout (same grid, same blocks) so nothing
 * jumps when the record lands. It shows no exception facts: every one comes from the
 * request still in flight, and a placeholder must never read as recorded evidence.
 */
export function ExceptionDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading exception" className="flex-1 overflow-hidden">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-44 rounded-md" />
        </div>
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_auto_1fr] xl:gap-x-6">
          <div className="xl:col-start-1">
            <Skeleton className="h-5 w-64 max-w-full rounded-md" />
            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div className="min-w-0 border-l-2 border-outline-v/40 pl-3 sm:col-span-3">
                <Skeleton className="h-3 w-16 rounded-md" />
                <Skeleton className="mt-2 h-4 w-80 max-w-full rounded-md" />
              </div>
              {Array.from({ length: CONTEXT_FACTS }).map((_, index) => (
                <div key={index} className="min-w-0 border-l-2 border-outline-v/40 pl-3">
                  <Skeleton className="h-3 w-16 rounded-md" />
                  <Skeleton className="mt-2 h-4 w-32 max-w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6 xl:col-start-1">
            <Skeleton variant="text" lines={2} />
          </div>
          <div className="min-w-0 overflow-hidden rounded-md border border-outline-v/60 bg-surf-lowest xl:col-start-2 xl:row-start-1 xl:row-span-3">
            <div className="border-b border-outline-v/30 bg-surf-low px-4 py-[10px] sm:px-6">
              <Skeleton className="h-3 w-24 rounded-md" />
            </div>
            <div className="flex flex-col gap-4 p-4 sm:p-6">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-28 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </div>
          <div className="min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6 xl:col-start-1">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton variant="text" lines={2} className="mt-3" />
          </div>
        </div>
      </div>
    </div>
  )
}
