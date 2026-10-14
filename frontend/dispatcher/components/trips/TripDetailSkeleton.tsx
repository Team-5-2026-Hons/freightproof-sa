'use client'

import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { BackButton } from '@/components/ui/BackButton'

const TIMELINE_ROWS = 6

interface Props {
  onBack: () => void
  /** Real header, rendered from the list row that led here. Absent on a cold URL. */
  header?: ReactNode
}

/**
 * The waiting state wears the finished layout.
 *
 * A centred spinner told a dispatcher only that something was happening; this says what
 * is coming and where, so nothing jumps when the record lands. It deliberately shows no
 * trip facts — every one of them comes from the request still in flight, and inventing
 * placeholders for evidence is the one thing this page must never do.
 */
export function TripDetailSkeleton({ onBack, header }: Props) {
  return (
    <div className="flex min-h-0 flex-1" role="status" aria-busy="true" aria-label="Loading trip">
      <div className="flex min-w-0 flex-1 flex-col">
        {header ?? <header className="shrink-0 border-b border-outline-v/30 bg-surf-lowest px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-start gap-3">
            <BackButton onClick={onBack} />
            <div className="min-w-0 flex-1 basis-48 space-y-2">
              <Skeleton className="h-6 w-56 max-w-full rounded-md" />
              <Skeleton className="h-3 w-32 max-w-full rounded-md" />
              <Skeleton className="h-4 w-72 max-w-full rounded-md" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="min-w-0 border-l-2 border-outline-v/30 pl-3">
                <Skeleton className="h-3 w-28 max-w-full rounded-md" />
                <Skeleton className="mt-2 h-4 w-40 max-w-full rounded-md" />
              </div>
            ))}
          </div>
        </header>}
        <div className="min-h-0 flex-1 overflow-hidden bg-surf-lowest">
          <section className="mx-auto w-full max-w-4xl p-4 md:p-6">
            <Skeleton className="mb-5 h-3 w-32 rounded-md" />
            {Array.from({ length: TIMELINE_ROWS }).map((_, index) => (
              <div key={index} className="flex gap-[14px]">
                <div className="flex shrink-0 flex-col items-center">
                  <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-full" />
                  {index < TIMELINE_ROWS - 1 && <div className="my-1 min-h-[20px] w-0.5 flex-1 bg-outline-v/30" />}
                </div>
                <div className="mb-3 min-w-0 flex-1 rounded-lg bg-surf-low px-4 py-3">
                  <Skeleton className="h-4 w-40 max-w-full rounded-md" />
                  <Skeleton className="mt-2 h-3 w-56 max-w-full rounded-md" />
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
      {/* Matches DetailPanel's own dock threshold so the shell and the real panel agree. */}
      <aside className="hidden w-[400px] shrink-0 flex-col border-l border-outline-v/30 bg-surf-low xl:flex">
        <div className="shrink-0 border-b border-outline-v/30 p-4"><Skeleton className="h-9 w-full rounded-[10px]" /></div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-4 w-full rounded-md" />)}
        </div>
      </aside>
      <span className="sr-only">Loading trip…</span>
    </div>
  )
}
