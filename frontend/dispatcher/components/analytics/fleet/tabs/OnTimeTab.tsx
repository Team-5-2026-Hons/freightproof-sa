'use client'

import { useState } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA } from '@/lib/format/analytics'
import { fmtBucketLabel, type TabQuery } from '@/lib/format/period'
import { useFleetOnTime, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { LATENESS_RAMP, NEUTRAL_COLOR, SERIES_COLORS } from '@/lib/tokens'
import type {
  FleetOnTime,
  Grain,
  LatenessBand,
  LatenessBar,
  PlanBand,
  PlanBandCount,
  PunctualityBucket,
} from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { CategoryBars } from '../charts/CategoryBars'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { SplitColumns } from '../charts/SplitColumns'
import { TrendLines } from '../charts/TrendLines'
import { EventSwitch, type PatternEvent } from '../controls/EventSwitch'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, fmtDuration, fmtShare, sumOf } from '../format'

const COPY = FLEET_COPY.onTime
const PERCENT = 100
const PERCENT_DOMAIN: [number, number] = [0, PERCENT]
const [DEPARTURE_COLOR, ARRIVAL_COLOR] = SERIES_COLORS
// Chart 2.5 (spec §5.2, D24): finished early in slot 1 (blue) left of the middle axis, ran over
// in slot 2 (orange) right of it. The early bands run towards the axis (furthest first), the
// over bands away from it (nearest first), so distance from the axis reads as distance off plan.
const [EARLY_COLOR, OVER_COLOR] = SERIES_COLORS
const EARLY_BANDS: readonly PlanBand[] = ['early_over_180', 'early_60_180', 'early_15_60', 'early_0_15']
const OVER_BANDS: readonly PlanBand[] = ['over_0_15', 'over_15_60', 'over_60_180', 'over_over_180']

// Early and On time are not lateness, so they stay neutral grey; the four late bands take the
// validated lateness ramp, light to dark, in order (spec §7.3).
const BAND_COLORS: Record<LatenessBand, string> = {
  early: NEUTRAL_COLOR,
  on_time: NEUTRAL_COLOR,
  late_1_15: LATENESS_RAMP[0],
  late_15_60: LATENESS_RAMP[1],
  late_60_180: LATENESS_RAMP[2],
  late_over_180: LATENESS_RAMP[3],
}

interface TrendCardProps {
  onTime: FleetQueryResult<FleetOnTime>
  grain: Grain
  today: string
}

/** "18 of 22 (82%)", or "—" when nothing had a plan. */
function fmtOnTime(onTime: number, total: number, rate: number | null): string {
  return total === 0 ? NO_DATA : `${onTime} of ${total} (${fmtShare(rate)})`
}

interface PunctualityRow {
  period: string
  departures: string
  arrivals: string
}

/** Chart 2.1: are we getting more punctual? Two lines on one 0–100 % axis. */
function PunctualityCard({ onTime, grain, today }: TrendCardProps) {
  const rows = onTime.data?.punctuality ?? []
  const departures = sumOf(rows, (row) => row.departures_with_plan)
  const arrivals = sumOf(rows, (row) => row.arrivals_with_plan)
  const tableRows: PunctualityRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    departures: fmtOnTime(row.on_time_departures, row.departures_with_plan, row.on_time_departure_rate),
    arrivals: fmtOnTime(row.on_time_arrivals, row.arrivals_with_plan, row.on_time_arrival_rate),
  }))
  const columns: Column<PunctualityRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'departures', label: COPY.punctuality.departuresOnTime },
    { key: 'arrivals', label: COPY.punctuality.arrivalsOnTime },
  ]
  const line = (onTimeCount: number, total: number, rate: number | null, noun: string, color: string) => ({
    value: fmtShare(rate),
    label: total === 0 ? COPY.punctuality.noPlan(noun) : COPY.punctuality.countOf(onTimeCount, total, noun),
    color,
  })

  return (
    <ChartCard
      title={COPY.punctuality.title}
      question={COPY.punctuality.question}
      basis={COPY.punctuality.basis(departures, arrivals)}
      note={COPY.punctuality.note}
      timeAxis
      sampleSize={Math.max(departures, arrivals)}
      legend={
        <ChartLegend
          items={[
            { label: COPY.punctuality.departures, color: DEPARTURE_COLOR, mark: 'line' },
            { label: COPY.punctuality.arrivals, color: ARRIVAL_COLOR, mark: 'line' },
          ]}
        />
      }
      {...queryState(onTime)}
      isEmpty={departures + arrivals === 0}
      emptyBody={COPY.punctuality.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<PunctualityBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.onTime}
        yDomain={PERCENT_DOMAIN}
        yTickFormat={(value) => `${value}%`}
        series={[
          {
            key: 'departures', label: COPY.punctuality.departures, color: DEPARTURE_COLOR,
            value: (row) => (row.on_time_departure_rate === null ? null : row.on_time_departure_rate * PERCENT),
          },
          {
            key: 'arrivals', label: COPY.punctuality.arrivals, color: ARRIVAL_COLOR,
            value: (row) => (row.on_time_arrival_rate === null ? null : row.on_time_arrival_rate * PERCENT),
          },
        ]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[
              line(row.on_time_departures, row.departures_with_plan, row.on_time_departure_rate, 'departures', DEPARTURE_COLOR),
              line(row.on_time_arrivals, row.arrivals_with_plan, row.on_time_arrival_rate, 'arrivals', ARRIVAL_COLOR),
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface LatenessRow {
  band: string
  trips: number
}

/** Chart 2.2: a little late often, or very late sometimes? Fixed band order, over the whole
 *  period, with its Departures | Arrivals switch on the title row (spec §7.7 item 5). */
function LatenessCard({ onTime }: { onTime: FleetQueryResult<FleetOnTime> }) {
  const [event, setEvent] = useState<PatternEvent>('departures')
  const bars = onTime.data?.lateness[event] ?? []
  const total = sumOf(bars, (bar) => bar.trip_count)
  const noun = FLEET_COPY.controls.events[event].toLowerCase()
  const tableRows: LatenessRow[] = bars.map((bar) => ({ band: COPY.lateness.bands[bar.band], trips: bar.trip_count }))
  const columns: Column<LatenessRow>[] = [
    { key: 'band', label: COPY.lateness.band },
    { key: 'trips', label: COPY.lateness.trips },
  ]

  return (
    <ChartCard
      title={COPY.lateness.title}
      question={COPY.lateness.question}
      basis={COPY.lateness.basis(total, noun)}
      sampleSize={total}
      controls={<EventSwitch value={event} onChange={setEvent} />}
      {...queryState(onTime)}
      isEmpty={total === 0}
      emptyBody={COPY.lateness.empty(noun)}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<LatenessBar>
        orientation="columns"
        rows={bars}
        rowKey={(bar) => bar.band}
        categoryLabel={(bar) => COPY.lateness.bands[bar.band]}
        yLabel={COPY.axis.trips}
        series={[{ key: 'trips', label: COPY.lateness.trips, color: (bar) => BAND_COLORS[bar.band], value: (bar) => bar.trip_count }]}
        renderTooltip={(bar) => (
          <ChartTooltip
            title={COPY.lateness.bands[bar.band]}
            lines={[{ value: String(bar.trip_count), label: noun, color: BAND_COLORS[bar.band] }]}
          />
        )}
      />
    </ChartCard>
  )
}

function isEarly(band: PlanBand): boolean {
  return band.startsWith('early')
}

/** The table's and tooltip's name for a band: the axis says "15–60 min", the side captions
 *  say which side it is on; off the chart, the direction has to be in the words. */
function bandLongLabel(band: PlanBand): string {
  const short = COPY.spread.bands[band]
  if (band === 'on_plan') return short
  return isEarly(band) ? COPY.spread.tableEarly(short) : COPY.spread.tableOver(short)
}

function bandTooltipLabel(bar: PlanBandCount): string {
  const short = COPY.spread.bands[bar.band]
  if (bar.band === 'on_plan') return COPY.spread.exactlyOnPlan
  return isEarly(bar.band) ? COPY.spread.finishedBand(short) : COPY.spread.ranBand(short)
}

interface SpreadRow {
  band: string
  trips: number
}

/** Chart 2.5 (spec §5.2, D24): a histogram split by a y-axis down the middle, where "on plan"
 *  is, over the whole period. Early bands grow up on its left, over bands on its right. Trips
 *  exactly on plan are named under the axis rather than drawn, because a column there would sit
 *  on the axis itself. No text on the card face (Tom): the summary lives in the table view. Not
 *  affected by View by. */
function PlanSpreadCard({ onTime }: { onTime: FleetQueryResult<FleetOnTime> }) {
  const spread = onTime.data?.plan_spread
  const bands = spread?.bands ?? []
  const counted = sumOf(bands, (bar) => bar.trip_count)
  const byBand = new Map(bands.map((bar) => [bar.band, bar]))
  const side = (order: readonly PlanBand[]): PlanBandCount[] =>
    order.map((band) => byBand.get(band) ?? { band, trip_count: 0 })
  const onPlan = spread?.on_plan_count ?? 0
  const summary = spread === undefined || counted === 0
    ? undefined
    : [
        COPY.spread.early(spread.early_count, spread.median_early_minutes === null ? null : fmtDuration(spread.median_early_minutes)),
        COPY.spread.over(spread.over_count, spread.median_over_minutes === null ? null : fmtDuration(spread.median_over_minutes)),
      ].join(' · ')
  const tableRows: SpreadRow[] = bands.map((bar) => ({ band: bandLongLabel(bar.band), trips: bar.trip_count }))
  const columns: Column<SpreadRow>[] = [
    { key: 'band', label: COPY.spread.columns.band },
    { key: 'trips', label: COPY.spread.columns.trips },
  ]

  return (
    <ChartCard
      className="lg:col-span-2"
      title={COPY.spread.title}
      question={COPY.spread.question}
      basis={COPY.spread.basis(counted)}
      note={COPY.spread.note}
      sampleSize={counted}
      legend={
        <ChartLegend
          items={[
            { label: COPY.spread.legend.early, color: EARLY_COLOR, mark: 'bar' },
            { label: COPY.spread.legend.over, color: OVER_COLOR, mark: 'bar' },
          ]}
        />
      }
      {...queryState(onTime)}
      isEmpty={counted === 0}
      emptyBody={COPY.spread.empty}
      table={
        <div className="flex flex-col gap-2">
          {summary !== undefined && <p className="text-[12px] text-on-surf-v">{summary}</p>}
          <DataTable columns={columns} rows={tableRows} />
        </div>
      }
    >
      <SplitColumns<PlanBandCount>
        left={side(EARLY_BANDS)}
        right={side(OVER_BANDS)}
        rowKey={(bar) => bar.band}
        categoryLabel={(bar) => COPY.spread.bands[bar.band]}
        value={(bar) => bar.trip_count}
        leftColor={EARLY_COLOR}
        rightColor={OVER_COLOR}
        yLabel={COPY.axis.trips}
        centreLabel={onPlan > 0 ? COPY.spread.onPlanCount(onPlan) : COPY.spread.onPlan}
        leftCaption={COPY.spread.finishedEarly}
        rightCaption={COPY.spread.ranOver}
        renderTooltip={(bar) => (
          <ChartTooltip
            title={bandLongLabel(bar.band)}
            lines={[{
              value: COPY.spread.trips(bar.trip_count),
              label: bandTooltipLabel(bar),
              color: isEarly(bar.band) ? EARLY_COLOR : OVER_COLOR,
            }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface OnTimeTabProps {
  query: TabQuery
  allTimeStart: string | null
  today: string
}

/** On time tab (spec §5.2, D23, D24): punctuality and lateness side by side, then the plan
 *  spread across the full width, where its two halves have room. One request for everything,
 *  for the tab's own period and grain. */
export function OnTimeTab({ query, allTimeStart, today }: OnTimeTabProps) {
  const onTime = useFleetOnTime(query, allTimeStart)
  // Label buckets by the grain the answer was built with, never one chosen after it was asked.
  const grain = onTime.data?.period.grain ?? query.grain

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PunctualityCard onTime={onTime} grain={grain} today={today} />
      <LatenessCard onTime={onTime} />
      <PlanSpreadCard onTime={onTime} />
    </div>
  )
}
