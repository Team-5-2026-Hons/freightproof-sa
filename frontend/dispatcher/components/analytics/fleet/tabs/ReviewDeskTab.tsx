'use client'

import Link from 'next/link'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtMinutes } from '@/lib/format/analytics'
import { fmtBucketLabel, type TabQuery } from '@/lib/format/period'
import { useFleetReview, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { SERIES_COLORS } from '@/lib/tokens'
import type {
  FleetReview,
  Grain,
  QueueBucket,
  ReviewOutcomeCount,
  TimeToReviewBucket,
  WaitingAgeBar,
} from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { CategoryBars } from '../charts/CategoryBars'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { DonutChart } from '../charts/DonutChart'
import { TrendLines } from '../charts/TrendLines'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, fmtShare, sumOf } from '../format'

const COPY = FLEET_COPY.review
const MINUTES_PER_HOUR = 60
const [SERIES_COLOR] = SERIES_COLORS

interface TabCardProps {
  review: FleetQueryResult<FleetReview>
  grain: Grain
  today: string
}

/** Hours as "2 h 15 m", the same form the rest of the page uses for durations. */
function fmtHours(hours: number | null): string {
  return hours === null ? NO_DATA : fmtMinutes(hours * MINUTES_PER_HOUR)
}

interface AgeRow {
  band: string
  count: number
}

/** Chart 4.1: right now, no period. Zero bars are good news, so they are drawn, never
 *  replaced by "not enough data". Links straight to the queue that holds them. */
function WaitingNowCard({ review }: { review: FleetQueryResult<FleetReview> }) {
  const bars = review.data?.waiting_by_age ?? []
  const waiting = sumOf(bars, (bar) => bar.count)
  const tableRows: AgeRow[] = bars.map((bar) => ({ band: COPY.waitingNow.bands[bar.band], count: bar.count }))
  const columns: Column<AgeRow>[] = [
    { key: 'band', label: COPY.waitingNow.band },
    { key: 'count', label: COPY.axis.waiting },
  ]

  return (
    <ChartCard
      title={COPY.waitingNow.title}
      question={COPY.waitingNow.question}
      basis={COPY.waitingNow.basis(waiting)}
      controls={
        <Link href="/exceptions" className="rounded-sm text-[12px] font-[600] text-sec hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec">
          {COPY.openQueue}
        </Link>
      }
      {...queryState(review)}
      isEmpty={false}
      emptyBody=""
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<WaitingAgeBar>
        orientation="columns"
        rows={bars}
        rowKey={(bar) => bar.band}
        categoryLabel={(bar) => COPY.waitingNow.bands[bar.band]}
        yLabel={COPY.axis.waiting}
        series={[{ key: 'count', label: COPY.axis.waiting, color: () => SERIES_COLOR, value: (bar) => bar.count }]}
        renderTooltip={(bar) => (
          <ChartTooltip title={COPY.waitingNow.bands[bar.band]} lines={[{ value: String(bar.count), label: COPY.waitingNow.lower, color: SERIES_COLOR }]} />
        )}
      />
    </ChartCard>
  )
}

interface QueueRow {
  period: string
  waiting: number
}

/** Chart 4.2: is the pile growing? Zeros are an answer here too, so the line is always drawn. */
function QueueCard({ review, grain, today }: TabCardProps) {
  const rows = review.data?.queue ?? []
  const tableRows: QueueRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    waiting: row.waiting_at_end,
  }))
  const columns: Column<QueueRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'waiting', label: COPY.queue.column },
  ]

  return (
    <ChartCard
      title={COPY.queue.title}
      question={COPY.queue.question}
      basis={COPY.queue.basis}
      timeAxis
      {...queryState(review)}
      isEmpty={false}
      emptyBody=""
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<QueueBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.waiting}
        series={[{ key: 'waiting', label: COPY.queue.waiting, color: SERIES_COLOR, value: (row) => row.waiting_at_end }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[{ value: String(row.waiting_at_end), label: COPY.queue.waiting, color: SERIES_COLOR }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface SpeedRow {
  period: string
  reviewed: number
  median: string
  mean: string
}

/** Chart 4.3: the typical (median) wait, with the average beside it in the tooltip, so one
 *  very slow review can't make the line look worse than a typical week was. */
function SpeedCard({ review, grain, today }: TabCardProps) {
  const rows = review.data?.time_to_review ?? []
  const reviewed = sumOf(rows, (row) => row.reviewed_count)
  const tableRows: SpeedRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    reviewed: row.reviewed_count,
    median: fmtHours(row.median_hours),
    mean: fmtHours(row.mean_hours),
  }))
  const columns: Column<SpeedRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'reviewed', label: COPY.speed.columns.reviewed },
    { key: 'median', label: COPY.speed.columns.median },
    { key: 'mean', label: COPY.speed.columns.mean },
  ]

  return (
    <ChartCard
      title={COPY.speed.title}
      question={COPY.speed.question}
      basis={COPY.speed.basis(reviewed)}
      timeAxis
      {...queryState(review)}
      isEmpty={reviewed === 0}
      emptyBody={COPY.speed.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<TimeToReviewBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.hours}
        allowDecimals
        series={[{ key: 'median', label: COPY.speed.median, color: SERIES_COLOR, value: (row) => row.median_hours }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[{ value: fmtHours(row.median_hours), label: COPY.speed.median, color: SERIES_COLOR }]}
            note={row.reviewed_count === 0 ? undefined : COPY.speed.mean(fmtHours(row.mean_hours), row.reviewed_count)}
          />
        )}
      />
    </ChartCard>
  )
}

interface OutcomeRow {
  outcome: string
  count: number
  share: string
}

type Outcome = ReviewOutcomeCount['outcome']

// Colour follows the outcome, never its size or rank: the five validated series slots, in the
// outcomes' fixed order (spec §7.3), so "Data discrepancy" is the same colour every period.
const OUTCOME_COLORS: Record<Outcome, string> = {
  no_action_required: SERIES_COLORS[0],
  handled_externally: SERIES_COLORS[1],
  evidence_verified: SERIES_COLORS[2],
  data_discrepancy: SERIES_COLORS[3],
  referred_for_follow_up: SERIES_COLORS[4],
}

/** Chart 4.4 (D25): what reviews concluded, as a donut. Every review ends in exactly one
 *  outcome, so the five are parts of one whole; the total sits in the middle, and each
 *  outcome's count and share are in the legend, so no value rests on the slice alone. */
function OutcomesCard({ review }: { review: FleetQueryResult<FleetReview> }) {
  const rows = review.data?.outcomes ?? []
  const total = sumOf(rows, (row) => row.count)
  const share = (count: number): string => fmtShare(total === 0 ? null : count / total)
  const tableRows: OutcomeRow[] = rows.map((row) => ({
    outcome: COPY.outcomes.labels[row.outcome], count: row.count, share: share(row.count),
  }))
  const columns: Column<OutcomeRow>[] = [
    { key: 'outcome', label: COPY.outcomes.outcome },
    { key: 'count', label: COPY.axis.reviews },
    { key: 'share', label: COPY.outcomes.share },
  ]

  return (
    <ChartCard
      title={COPY.outcomes.title}
      question={COPY.outcomes.question}
      basis={COPY.outcomes.basis(total)}
      note={COPY.outcomes.note}
      legend={
        <ChartLegend
          items={rows.map((row) => ({
            label: `${COPY.outcomes.labels[row.outcome]} · ${COPY.outcomes.legendValue(row.count, share(row.count))}`,
            color: OUTCOME_COLORS[row.outcome],
            mark: 'bar' as const,
          }))}
        />
      }
      {...queryState(review)}
      isEmpty={total === 0}
      emptyBody={COPY.outcomes.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <DonutChart<ReviewOutcomeCount>
        rows={rows}
        rowKey={(row) => row.outcome}
        value={(row) => row.count}
        color={(row) => OUTCOME_COLORS[row.outcome]}
        centre={COPY.outcomes.centre(total)}
        renderTooltip={(row) => (
          <ChartTooltip
            title={COPY.outcomes.labels[row.outcome]}
            lines={[{ value: String(row.count), label: `${COPY.axis.reviews.toLowerCase()} (${share(row.count)})`, color: OUTCOME_COLORS[row.outcome] }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface ReviewDeskTabProps {
  query: TabQuery
  allTimeStart: string | null
  today: string
}

/** Review desk tab (spec §5.4): waiting now on top, then the queue's history, the speed of
 *  review and what reviews found. One request, for the tab's own period and grain. */
export function ReviewDeskTab({ query, allTimeStart, today }: ReviewDeskTabProps) {
  const review = useFleetReview(query, allTimeStart)
  const grain = review.data?.period.grain ?? query.grain

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-on-surf-v">{COPY.tabNote}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WaitingNowCard review={review} />
        <QueueCard review={review} grain={grain} today={today} />
        <SpeedCard review={review} grain={grain} today={today} />
        <OutcomesCard review={review} />
      </div>
    </div>
  )
}
