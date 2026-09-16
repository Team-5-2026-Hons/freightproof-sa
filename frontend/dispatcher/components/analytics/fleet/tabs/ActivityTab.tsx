'use client'

import Link from 'next/link'
import { useState } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import {
  coversFullYear,
  fmtBucketLabel,
  fmtSastDay,
  resolvePeriod,
  type PeriodSelection,
  type TabQuery,
} from '@/lib/format/period'
import { useFleetActivity, useFleetPatterns, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { SERIES_COLORS } from '@/lib/tokens'
import type {
  CancellationsBucket,
  FleetActivity,
  Grain,
  TripsBucket,
} from '@shared/lib/types/fleet-analytics'
import { ChartCard } from '../ChartCard'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { PatternStrip } from '../charts/PatternStrip'
import { TrendColumns } from '../charts/TrendColumns'
import { TrendLines } from '../charts/TrendLines'
import { EventSwitch, type PatternEvent } from '../controls/EventSwitch'
import { PeriodControl } from '../controls/PeriodControl'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, fmtShare } from '../format'

const COPY = FLEET_COPY.activity
const [LOADED_COLOR, EMPTY_COLOR] = SERIES_COLORS

interface TrendCardProps {
  activity: FleetQueryResult<FleetActivity>
  grain: Grain
  today: string
}

interface TripsRow {
  period: string
  loaded: number
  empty: number
  total: number
}

/** Chart 1.1: are we getting busier? Loaded runs under empty runs, per bucket. */
function TripsCard({ activity, grain, today }: TrendCardProps) {
  const rows = activity.data?.trips ?? []
  const total = rows.reduce((sum, row) => sum + row.loaded_count + row.empty_count, 0)
  const tableRows: TripsRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    loaded: row.loaded_count,
    empty: row.empty_count,
    total: row.loaded_count + row.empty_count,
  }))
  const columns: Column<TripsRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'loaded', label: COPY.trips.loaded },
    { key: 'empty', label: COPY.trips.emptyRun },
    { key: 'total', label: COPY.trips.total },
  ]

  return (
    <ChartCard
      title={COPY.trips.title}
      question={COPY.trips.question}
      basis={COPY.trips.basis(total)}
      sampleSize={total}
      timeAxis
      legend={
        <ChartLegend
          items={[
            { label: COPY.trips.loaded, color: LOADED_COLOR, mark: 'bar' },
            { label: COPY.trips.emptyRun, color: EMPTY_COLOR, mark: 'bar' },
          ]}
        />
      }
      isLoading={activity.isLoading}
      isRefreshing={activity.isRefreshing}
      error={activity.error}
      onRetry={activity.refetch}
      isEmpty={total === 0}
      emptyBody={COPY.trips.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<TripsBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.trips}
        series={[
          { key: 'loaded', label: COPY.trips.loaded, color: LOADED_COLOR, value: (row) => row.loaded_count },
          { key: 'empty', label: COPY.trips.emptyRun, color: EMPTY_COLOR, value: (row) => row.empty_count },
        ]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[
              { value: String(row.loaded_count + row.empty_count), label: COPY.trips.trips },
              { value: String(row.loaded_count), label: COPY.trips.loadedLower, color: LOADED_COLOR },
              { value: String(row.empty_count), label: COPY.trips.emptyLower, color: EMPTY_COLOR },
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface CancellationsRow {
  period: string
  cancelled: number
  ended: number
  rate: string
}

interface CancelledTripRow {
  reference: string
  tripId: string
  cancelledOn: string
}

/** Chart 1.7: how often are trips abandoned? One line; its table also lists every
 *  cancelled trip with a link to it, where the cancellation note is shown (spec D20). */
function CancellationsCard({ activity, grain, today }: TrendCardProps) {
  const rows = activity.data?.cancellations ?? []
  const cancelled = rows.reduce((sum, row) => sum + row.cancelled_count, 0)
  const ended = rows.reduce((sum, row) => sum + row.ended_count, 0)
  const bucketRows: CancellationsRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    cancelled: row.cancelled_count,
    ended: row.ended_count,
    rate: fmtShare(row.cancelled_rate),
  }))
  const bucketColumns: Column<CancellationsRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'cancelled', label: COPY.cancellations.columns.cancelled },
    { key: 'ended', label: COPY.cancellations.columns.ended },
    { key: 'rate', label: COPY.cancellations.columns.rate },
  ]
  const tripRows: CancelledTripRow[] = (activity.data?.cancelled_trips ?? []).map((trip) => ({
    reference: trip.trip_reference, tripId: trip.trip_id, cancelledOn: fmtSastDay(trip.cancelled_at),
  }))
  const tripColumns: Column<CancelledTripRow>[] = [
    {
      key: 'reference',
      label: COPY.cancellations.reference,
      render: (_value, row) => (
        <Link href={`/trips/${row.tripId}`} className="font-[600] text-sec hover:underline">{row.reference}</Link>
      ),
    },
    { key: 'cancelledOn', label: COPY.cancellations.cancelledOn },
  ]

  return (
    <ChartCard
      title={COPY.cancellations.title}
      question={COPY.cancellations.question}
      basis={COPY.cancellations.basis(cancelled, ended)}
      sampleSize={ended}
      timeAxis
      isLoading={activity.isLoading}
      isRefreshing={activity.isRefreshing}
      error={activity.error}
      onRetry={activity.refetch}
      isEmpty={ended === 0}
      emptyBody={COPY.cancellations.empty}
      table={
        <div className="flex flex-col gap-4">
          <DataTable columns={bucketColumns} rows={bucketRows} />
          <div className="flex flex-col gap-2">
            <h4 className="text-[13px] font-[700] text-on-surf">{COPY.cancellations.listTitle}</h4>
            <p className="text-[12px] text-on-surf-v">{COPY.cancellations.listHint}</p>
            <DataTable
              columns={tripColumns}
              rows={tripRows}
              empty={{ title: COPY.cancellations.listTitle, body: COPY.cancellations.listEmpty }}
            />
          </div>
        </div>
      }
    >
      <TrendLines<CancellationsBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.cancelledTrips}
        series={[{ key: 'cancelled', label: COPY.cancellations.cancelled, color: SERIES_COLORS[0], value: (row) => row.cancelled_count }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[{ value: String(row.cancelled_count), label: COPY.cancellations.cancelled, color: SERIES_COLORS[0] }]}
            note={COPY.cancellations.outOf(row.ended_count, fmtShare(row.cancelled_rate))}
          />
        )}
      />
    </ChartCard>
  )
}

interface ActivityTabProps {
  /** The tab's trend period and grain, resolved by the page from its control row. */
  query: TabQuery
  allTimeStart: string | null
  today: string
  /** The busy patterns' own period (spec D5), kept by the page so it survives tab switches. */
  patternPeriod: PeriodSelection
  onPatternPeriodChange: (period: PeriodSelection) => void
}

/** Activity tab (spec §5.1): trips and cancellations over time, then the busy patterns
 *  with their own period. Only this tab's two requests run while it is open. */
export function ActivityTab({ query, allTimeStart, today, patternPeriod, onPatternPeriodChange }: ActivityTabProps) {
  const activity = useFleetActivity(query, allTimeStart)
  const patterns = useFleetPatterns(resolvePeriod(patternPeriod, today))
  const [event, setEvent] = useState<PatternEvent>('departures')
  // Label buckets by the grain the answer was built with, so a slow reply is never
  // mislabelled with a grain chosen after it was requested.
  const grain = activity.data?.period.grain ?? query.grain
  const patternEcho = patterns.data?.period
  const monthNote = patternEcho !== undefined && !coversFullYear(patternEcho.start, patternEcho.end)
    ? COPY.patterns.monthNeedsYear
    : undefined
  const eventNoun = FLEET_COPY.controls.events[event].toLowerCase()

  return (
    <div className="flex flex-col gap-4">
      <TripsCard activity={activity} grain={grain} today={today} />
      <CancellationsCard activity={activity} grain={grain} today={today} />

      <section aria-labelledby="busy-patterns-title" className="flex flex-col gap-3 pt-2">
        <div>
          <h3 id="busy-patterns-title" className="text-[15px] font-[800] text-on-surf">{COPY.patterns.title}</h3>
          <p className="text-[12px] text-on-surf-v">{COPY.patterns.intro}</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <PeriodControl
            value={patternPeriod}
            onChange={onPatternPeriodChange}
            today={today}
            allTimeStart={allTimeStart}
            label={COPY.patterns.period}
          />
          <EventSwitch value={event} onChange={setEvent} />
        </div>
        <PatternStrip
          set={patterns.data?.[event] ?? null}
          eventNoun={eventNoun}
          isLoading={patterns.isLoading}
          isRefreshing={patterns.isRefreshing}
          error={patterns.error}
          onRetry={patterns.refetch}
          monthNote={monthNote}
          yLabel={COPY.axis.avgPerDay}
        />
      </section>
    </div>
  )
}
