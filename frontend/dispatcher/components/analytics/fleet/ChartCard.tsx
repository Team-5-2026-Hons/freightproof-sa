'use client'

import { useId, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import { LOW_SAMPLE_TRIPS } from '@/lib/format/period'
import { cn } from '@shared/lib/utils/cn'
import { ChartZoom } from './ChartZoom'
import { CHART_HEIGHT } from './charts/chartStyle'
import { FLEET_COPY } from './copy'
import { InfoPopover } from './InfoPopover'
import type { FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'

const COPY = FLEET_COPY.chart

/** The four ChartCard props that come straight from a tab's query, so each card spreads
 *  them instead of repeating them. */
export function queryState<T>(result: FleetQueryResult<T>) {
  return { isLoading: result.isLoading, isRefreshing: result.isRefreshing, error: result.error, onRetry: result.refetch }
}

interface ChartCardProps {
  title: string
  /** The question the chart answers, in the dispatcher's words. Shown in the "i" popover. */
  question: string
  /** The sample behind the chart, e.g. "Closed trips, by the day they first departed · 16
   *  trips". Shown in the "i" popover, under the question. */
  basis?: string
  /** Trips behind the chart. Under LOW_SAMPLE_TRIPS the chart still draws, with a warning. */
  sampleSize?: number
  /** A caveat that changes how the chart should be read, e.g. "Needs a full year of history to
   *  compare months fairly." Shown on the card face like the low-sample warning, never behind
   *  the "i": the reader needs it before reading the bars, not after clicking (spec §7.7). */
  caveat?: string
  /** How to read the chart (the spec's captions). Shown in the "i" popover, under the basis. */
  note?: string
  /** The card draws buckets over time, so its popover ends with what a faded bucket means
   *  (spec §7.7 item 6). The legend row no longer carries that line. */
  timeAxis?: boolean
  /** Controls for this one chart, e.g. a Departures | Arrivals switch. In the header, visible in
   *  every state, so an empty half can still be switched away from. */
  controls?: ReactNode
  legend?: ReactNode
  isLoading: boolean
  /** A new period is loading while the previous chart is still shown. */
  isRefreshing?: boolean
  error: string | null
  onRetry: () => void
  isEmpty: boolean
  /** Specific to the chart, e.g. "No closed trips departed in this period." */
  emptyBody: string
  /** The table twin: every value reachable without hovering (spec §7.4). */
  table: ReactNode
  /** The chart itself. */
  children: ReactNode
  /** Placeholder height on first load: the chart's own height, so nothing jumps. */
  chartHeight?: number
  className?: string
}

/** The frame every fleet chart sits in, owning the states of spec §7.6: first load, refetch,
 *  error, no observations and low sample, plus the Show table toggle.
 *
 *  Card face (spec §7.7, D22): the title with an "i" button beside it. The question and basis
 *  live in that popover, so the face stays clean. The low-sample warning stays on the face,
 *  because it is a warning, not a description, and must be seen without clicking. */
export function ChartCard({
  title, question, basis, sampleSize, caveat, note, timeAxis = false, controls, legend, isLoading, isRefreshing = false, error, onRetry,
  isEmpty, emptyBody, table, children, chartHeight = CHART_HEIGHT, className,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  const titleId = `${id}-title`
  const bodyId = `${id}-body`
  const isReady = error === null && !isLoading && !isEmpty
  const isLowSample = sampleSize !== undefined && sampleSize > 0 && sampleSize < LOW_SAMPLE_TRIPS

  // The ready view, shared by the card and its zoom modal so the two can never show different
  // things: the warnings, then the chart or its table, whichever the card is showing.
  const view = (
    <>
      {isLowSample && <p className="mb-2 text-[12px] font-[600] text-warn">{COPY.lowSample(sampleSize)}</p>}
      {caveat !== undefined && <p className="mb-2 text-[12px] text-on-surf-v">{caveat}</p>}
      {showTable ? table : children}
    </>
  )

  let content: ReactNode
  if (error !== null) {
    // Checked first: a failed refetch clears the data, so there is nothing stale to show.
    content = (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-[13px] text-on-surf">
        <span className="text-on-surf-v"><Ic n="warn" s={24} /></span>
        <p>{COPY.loadError} {error}</p>
        <Button size="sm" variant="ghost" onClick={onRetry}>{COPY.retry}</Button>
      </div>
    )
  } else if (isLoading) {
    content = <div style={{ height: chartHeight }}><Skeleton className="h-full" /></div>
  } else if (isEmpty) {
    content = <EmptyState icon={<Ic n="bars" s={48} />} title={COPY.notEnoughTitle} body={emptyBody} className="py-8" />
  } else {
    content = view
  }

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-3 rounded-lg bg-surf-lowest p-4 shadow-level-3', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h3 id={titleId} className="text-[14px] font-[700] text-on-surf">{title}</h3>
          <InfoPopover
            title={title} question={question} basis={basis} note={note}
            footnote={timeAxis ? COPY.partialFootnote : undefined}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {isReady && (
            <Button
              size="sm" variant="ghost" aria-pressed={showTable} aria-controls={bodyId}
              onClick={() => setShowTable((shown) => !shown)}
            >
              {showTable ? COPY.showChart : COPY.showTable}
            </Button>
          )}
          {/* Only with something to enlarge: zooming a placeholder, an error or an empty state
              would show the same message bigger. */}
          {isReady && (
            <ChartZoom title={title}>
              <div className="flex flex-col gap-3">
                {!showTable && legend}
                <div>{view}</div>
              </div>
            </ChartZoom>
          )}
        </div>
      </header>
      {isReady && !showTable && legend}
      <div
        id={bodyId}
        aria-busy={isLoading || isRefreshing}
        className={cn('transition-opacity duration-150', isRefreshing && 'opacity-50')}
      >
        {content}
      </div>
    </section>
  )
}
