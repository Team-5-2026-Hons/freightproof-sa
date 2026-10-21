'use client'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtRand } from '@/lib/format/analytics'
import { fmtBucketLabel, type TabQuery } from '@/lib/format/period'
import { useFleetCost, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { SERIES_COLORS } from '@/lib/tokens'
import type { CostBucket, FleetCost, LaneCost } from '@shared/lib/types/cost-analytics'
import type { Grain } from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { CategoryBars } from '../charts/CategoryBars'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { TrendColumns } from '../charts/TrendColumns'
import { CostKindLabel, type CostKind } from '../CostKindLabel'
import { CostRatesCard } from '../CostRatesCard'
import { COST_COPY } from '../costCopy'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, sumOf } from '../format'

const COPY = COST_COPY
// Enough lanes to see the costly ones at a glance; the table twin lists them all.
const TOP_LANES = 10
// Lane names are long, as on Routes & sites.
const LANE_AXIS_WIDTH = 280
const LATE_HOURS_DECIMALS = 1
// The headline card's placeholder while loading: about the height of three figures and their lines.
const HEADLINE_HEIGHT = 120

// One colour per cost part, in the order they stack (fuel at the bottom, the biggest share).
const PART_COLORS = {
  fuel: SERIES_COLORS[0],
  running: SERIES_COLORS[1],
  driver: SERIES_COLORS[2],
  fixed: SERIES_COLORS[3],
} as const
const DELAY_COLOR = SERIES_COLORS[1]
const UNDER_REVIEW_COLOR = SERIES_COLORS[1]
const REVIEWED_COLOR = SERIES_COLORS[0]
const LANE_COLOR = SERIES_COLORS[0]

interface CardProps {
  cost: FleetQueryResult<FleetCost>
  grain: Grain
  today: string
}

/** True when no closed trip departed in the period: nothing to cost, delay or expose. */
function noClosedTrips(cost: FleetCost | null): boolean {
  return cost === null || cost.operating.trips_costed + cost.operating.trips_not_costed === 0
}

interface HeadlineFigureProps {
  label: string
  value: string
  kind: CostKind
  lines: string[]
}

function HeadlineFigure({ label, value, kind, lines }: HeadlineFigureProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-on-surf tabular-nums">{value}</span>
        <CostKindLabel kind={kind} />
      </div>
      <div className="text-[12px] font-[600] text-on-surf-v">{label}</div>
      {lines.map((line) => <div key={line} className="text-[12px] leading-snug text-on-surf-v">{line}</div>)}
    </div>
  )
}

interface HeadlineRow {
  figure: string
  value: string
  kind: string
  detail: string
}

/** The three answers the ticket asks for, each labelled estimate or waybill on the card face. */
function HeadlineCard({ cost }: { cost: FleetQueryResult<FleetCost> }) {
  const data = cost.data
  const h = COPY.headline
  const figures: HeadlineFigureProps[] = data === null ? [] : [
    {
      label: h.operating,
      value: fmtRand(data.operating.total),
      kind: 'estimate',
      lines: [
        h.tripsCosted(data.operating.trips_costed, data.operating.trips_not_costed),
        ...(data.operating.legs_estimated > 0
          ? [h.legsEstimated(data.operating.legs_estimated, data.operating.legs_estimated + data.operating.legs_routed)]
          : []),
      ],
    },
    {
      label: h.delay,
      value: fmtRand(data.delay.cost),
      kind: 'estimate',
      lines: [
        h.lateOver(data.delay.late_hours.toFixed(LATE_HOURS_DECIMALS), data.delay.late_problem_trips),
        ...(data.delay.lateness_unknown > 0 ? [h.latenessUnknown(data.delay.lateness_unknown)] : []),
      ],
    },
    {
      label: h.exposure,
      value: fmtRand(data.exposure.total),
      kind: 'waybill',
      lines: [
        h.underReview(fmtRand(data.exposure.under_review)),
        ...(data.exposure.consignments_without_value > 0 ? [h.noValue(data.exposure.consignments_without_value)] : []),
        ...(data.exposure.trips_without_consignments > 0 ? [h.noConsignments(data.exposure.trips_without_consignments)] : []),
      ],
    },
  ]
  const columns: Column<HeadlineRow>[] = [
    { key: 'figure', label: h.figure },
    { key: 'value', label: h.value },
    { key: 'kind', label: h.kindColumn },
    { key: 'detail', label: h.detail },
  ]
  const rows: HeadlineRow[] = figures.map((figure) => ({
    figure: figure.label, value: figure.value, kind: COPY.kind[figure.kind], detail: figure.lines.join(' · '),
  }))

  return (
    <ChartCard
      title={h.title}
      question={h.question}
      source={h.source}
      note={h.note}
      {...queryState(cost)}
      isEmpty={noClosedTrips(data)}
      emptyBody={COPY.noTrips}
      table={<DataTable columns={columns} rows={rows} />}
      chartHeight={HEADLINE_HEIGHT}
      className="lg:col-span-2"
    >
      <div className="grid grid-cols-1 gap-6 py-2 md:grid-cols-3">
        {figures.map((figure) => <HeadlineFigure key={figure.label} {...figure} />)}
      </div>
    </ChartCard>
  )
}

interface OperatingRow {
  period: string
  fuel: string
  running: string
  driver: string
  fixed: string
  total: string
}

/** Operating cost over time, stacked by what drives it (fuel, other running, driver, fixed). */
function OperatingCard({ cost, grain, today }: CardProps) {
  const o = COPY.operating
  const rows = cost.data?.buckets ?? []
  const total = (row: CostBucket): number => row.fuel + row.running + row.driver + row.fixed
  const tableRows: OperatingRow[] = rows.map((row) => ({
    period: fmtBucketName(row.start, row.is_partial, grain, today),
    fuel: fmtRand(row.fuel), running: fmtRand(row.running), driver: fmtRand(row.driver),
    fixed: fmtRand(row.fixed), total: fmtRand(total(row)),
  }))
  const columns: Column<OperatingRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'fuel', label: o.fuel },
    { key: 'running', label: o.running },
    { key: 'driver', label: o.driver },
    { key: 'fixed', label: o.fixed },
    { key: 'total', label: o.total },
  ]
  const series = [
    { key: 'fuel', label: o.fuel, color: PART_COLORS.fuel, value: (row: CostBucket) => row.fuel },
    { key: 'running', label: o.running, color: PART_COLORS.running, value: (row: CostBucket) => row.running },
    { key: 'driver', label: o.driver, color: PART_COLORS.driver, value: (row: CostBucket) => row.driver },
    { key: 'fixed', label: o.fixed, color: PART_COLORS.fixed, value: (row: CostBucket) => row.fixed },
  ]
  const costed = cost.data?.operating.trips_costed ?? 0

  return (
    <ChartCard
      title={o.title}
      question={o.question}
      source={o.source}
      basis={o.basis(costed)}
      timeAxis
      sampleSize={costed}
      legend={<ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, mark: 'bar' as const }))} />}
      {...queryState(cost)}
      isEmpty={costed === 0}
      emptyBody={COPY.noTrips}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<CostBucket>
        rows={rows}
        rowKey={(row) => row.start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.rand}
        series={series}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.start, row.is_partial, grain, today)}
            lines={series.map((s) => ({ value: fmtRand(s.value(row)), label: s.label, color: s.color }))}
            note={`${o.total}: ${fmtRand(total(row))}`}
          />
        )}
      />
    </ChartCard>
  )
}

interface DelayRow {
  period: string
  cost: string
}

/** Delay cost on problem trips over time. Beside operating cost, never added to it. */
function DelayCard({ cost, grain, today }: CardProps) {
  const d = COPY.delay
  const rows = cost.data?.buckets ?? []
  const total = sumOf(rows, (row) => row.delay_cost)
  const columns: Column<DelayRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'cost', label: d.cost },
  ]
  const tableRows: DelayRow[] = rows.map((row) => ({
    period: fmtBucketName(row.start, row.is_partial, grain, today), cost: fmtRand(row.delay_cost),
  }))

  return (
    <ChartCard
      title={d.title}
      question={d.question}
      source={d.source}
      basis={d.basis(cost.data?.delay.problem_trips ?? 0)}
      timeAxis
      {...queryState(cost)}
      isEmpty={total === 0}
      emptyBody={noClosedTrips(cost.data) ? COPY.noTrips : d.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<CostBucket>
        rows={rows}
        rowKey={(row) => row.start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.rand}
        series={[{ key: 'delay', label: d.cost, color: DELAY_COLOR, value: (row) => row.delay_cost }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.start, row.is_partial, grain, today)}
            lines={[{ value: fmtRand(row.delay_cost), label: d.cost, color: DELAY_COLOR }]}
          />
        )}
      />
    </ChartCard>
  )
}

interface ValueRow {
  period: string
  underReview: string
  reviewed: string
}

/** Declared cargo value on theft-signal trips over time: still under review below, reviewed above. */
function ValueCard({ cost, grain, today }: CardProps) {
  const v = COPY.value
  const rows = cost.data?.buckets ?? []
  const total = sumOf(rows, (row) => row.value_under_review + row.value_reviewed)
  const series = [
    { key: 'underReview', label: v.underReview, color: UNDER_REVIEW_COLOR, value: (row: CostBucket) => row.value_under_review },
    { key: 'reviewed', label: v.reviewed, color: REVIEWED_COLOR, value: (row: CostBucket) => row.value_reviewed },
  ]
  const columns: Column<ValueRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'underReview', label: v.underReview },
    { key: 'reviewed', label: v.reviewed },
  ]
  const tableRows: ValueRow[] = rows.map((row) => ({
    period: fmtBucketName(row.start, row.is_partial, grain, today),
    underReview: fmtRand(row.value_under_review), reviewed: fmtRand(row.value_reviewed),
  }))

  return (
    <ChartCard
      title={v.title}
      question={v.question}
      source={v.source}
      basis={v.basis(cost.data?.exposure.trips ?? 0)}
      timeAxis
      legend={<ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, mark: 'bar' as const }))} />}
      {...queryState(cost)}
      isEmpty={total === 0}
      emptyBody={noClosedTrips(cost.data) ? COPY.noTrips : v.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<CostBucket>
        rows={rows}
        rowKey={(row) => row.start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.rand}
        series={series}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.start, row.is_partial, grain, today)}
            lines={series.map((s) => ({ value: fmtRand(s.value(row)), label: s.label, color: s.color }))}
          />
        )}
      />
    </ChartCard>
  )
}

function laneName(lane: LaneCost): string {
  const l = COPY.lanes
  return l.lane(lane.origin_name ?? l.unknownSite, lane.destination_name ?? l.unknownSite)
}

function laneKey(lane: LaneCost): string {
  return `${lane.origin_precinct_id}:${lane.destination_precinct_id}`
}

interface LaneRow {
  lane: string
  trips: number
  operating: string
  perTrip: string
  delay: string
  value: string
  distance: string
}

/** The costliest lanes by estimated operating cost; delay and value exposed sit beside it. */
function LanesCard({ cost }: { cost: FleetQueryResult<FleetCost> }) {
  const l = COPY.lanes
  const lanes = cost.data?.lanes ?? []
  const shown = lanes.slice(0, TOP_LANES)
  const columns: Column<LaneRow>[] = [
    { key: 'lane', label: l.laneColumn },
    { key: 'trips', label: l.trips },
    { key: 'operating', label: l.operating },
    { key: 'perTrip', label: l.perTrip },
    { key: 'delay', label: l.delay },
    { key: 'value', label: l.value },
    { key: 'distance', label: l.distance },
  ]
  const tableRows: LaneRow[] = lanes.map((lane) => ({
    lane: laneName(lane),
    trips: lane.trip_count,
    operating: fmtRand(lane.operating_total),
    perTrip: fmtRand(lane.operating_per_trip),
    delay: fmtRand(lane.delay_cost),
    value: fmtRand(lane.value_exposed),
    // A lane none of whose trips was costed measured no distance, so it has no source to name.
    distance: lane.operating_per_trip === null ? NO_DATA : l.distanceSource[lane.distance_source],
  }))

  return (
    <ChartCard
      title={l.title}
      question={l.question}
      source={l.source}
      basis={l.basis(shown.length, lanes.length)}
      {...queryState(cost)}
      isEmpty={lanes.length === 0}
      emptyBody={l.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<LaneCost>
        orientation="bars"
        stacked={false}
        categoryAxisWidth={LANE_AXIS_WIDTH}
        rows={shown}
        rowKey={laneKey}
        categoryLabel={laneName}
        yLabel={COPY.axis.rand}
        series={[{ key: 'operating', label: l.operating, color: () => LANE_COLOR, value: (lane) => lane.operating_total }]}
        renderTooltip={(lane) => (
          <ChartTooltip
            title={laneName(lane)}
            lines={[
              { value: fmtRand(lane.operating_total), label: l.operating.toLowerCase(), color: LANE_COLOR },
              { value: fmtRand(lane.delay_cost), label: l.delay.toLowerCase() },
              { value: fmtRand(lane.value_exposed), label: l.value.toLowerCase() },
            ]}
            note={l.tooltipTrips(lane.trip_count, fmtRand(lane.operating_per_trip))}
          />
        )}
      />
    </ChartCard>
  )
}

interface CostTabProps {
  query: TabQuery
  allTimeStart: string | null
  today: string
}

/** The Cost tab (FP-294): estimated operating and delay cost, and waybill cargo value exposed,
 *  each saying where it came from, with the rates behind every estimate at the bottom. */
export function CostTab({ query, allTimeStart, today }: CostTabProps) {
  const cost = useFleetCost(query, allTimeStart)
  const grain = cost.data?.period.grain ?? query.grain

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HeadlineCard cost={cost} />
        <OperatingCard cost={cost} grain={grain} today={today} />
        <DelayCard cost={cost} grain={grain} today={today} />
        <ValueCard cost={cost} grain={grain} today={today} />
        <LanesCard cost={cost} />
        <CostRatesCard rates={cost.data?.rates ?? null} onSaved={cost.refetch} className="lg:col-span-2" />
      </div>
    </div>
  )
}
