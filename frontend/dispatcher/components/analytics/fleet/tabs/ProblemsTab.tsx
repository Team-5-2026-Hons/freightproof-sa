'use client'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { Ic } from '@/components/ui/Ic'
import { NO_DATA, fmtMinutes } from '@/lib/format/analytics'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtBucketLabel, type TabQuery } from '@/lib/format/period'
import { useFleetProblems, type FleetQueryResult } from '@/lib/hooks/useFleetAnalytics'
import { SERIES_COLORS, STATUS_COLORS } from '@/lib/tokens'
import type {
  ExceptionSource,
  ExceptionType,
} from '@shared/lib/types/exception'
import type {
  FleetProblems,
  Grain,
  ProblemStepCount,
  ProblemsPerTripBucket,
  RiskyTimeBlock,
  TheftSignalsBucket,
} from '@shared/lib/types/fleet-analytics'
import { ChartCard, queryState } from '../ChartCard'
import { CategoryBars } from '../charts/CategoryBars'
import { ChartLegend } from '../charts/ChartLegend'
import { ChartTooltip } from '../charts/ChartTooltip'
import { TrendColumns } from '../charts/TrendColumns'
import { TrendLines } from '../charts/TrendLines'
import { FLEET_COPY } from '../copy'
import { fmtBucketName, fmtShare, sumOf } from '../format'

const COPY = FLEET_COPY.problems
const LEGEND_ICON_SIZE = 12
const PERCENT = 100
// A rate per trip reads best with at most one decimal at today's volumes ("4", "0.5").
const PER_TRIP_DECIMALS = 1
const SOURCES: readonly ExceptionSource[] = ['system', 'driver', 'dispatcher']
// Trip creation and activation are rare places for a problem, so they only appear when
// something actually happened there.
const OPTIONAL_STEPS: ReadonlySet<string> = new Set(['trip_creation', 'activation'])

interface TabCardProps {
  problems: FleetQueryResult<FleetProblems>
  grain: Grain
  today: string
}

/** Problems per trip, "—" when no trip departed in the period. */
function fmtPerTrip(problems: number, trips: number): string {
  if (trips === 0) return NO_DATA
  return String(Number((problems / trips).toFixed(PER_TRIP_DECIMALS)))
}

interface PerTripRow {
  period: string
  trips: number
  warning: number
  critical: number
  info: number
  perTrip: string
}

/** Chart 3.1: are things getting better or worse? The number of problems in each period,
 *  warning under critical. Rate per trip sits in the tooltip and table beside the trip count.
 *  Status colours carry icons too, never colour alone: warning amber is only 1.7:1 against white. */
function PerTripCard({ problems, grain, today }: TabCardProps) {
  const rows = problems.data?.per_trip ?? []
  const trips = sumOf(rows, (row) => row.trip_count)
  const counted = sumOf(rows, (row) => row.warning_count + row.critical_count)
  const showInfo = rows.some((row) => row.info_count > 0)
  const tableRows: PerTripRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    trips: row.trip_count,
    warning: row.warning_count,
    critical: row.critical_count,
    info: row.info_count,
    perTrip: fmtPerTrip(row.warning_count + row.critical_count, row.trip_count),
  }))
  const columns: Column<PerTripRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    { key: 'trips', label: COPY.perTrip.trips },
    { key: 'warning', label: COPY.perTrip.warning },
    { key: 'critical', label: COPY.perTrip.critical },
    // Nothing raises info today; its column appears only if something ever does.
    ...(showInfo ? [{ key: 'info' as const, label: COPY.perTrip.info }] : []),
    { key: 'perTrip', label: COPY.perTrip.perTrip },
  ]

  return (
    <ChartCard
      title={COPY.perTrip.title}
      question={COPY.perTrip.question}
      basis={COPY.perTrip.basis(counted, trips)}
      timeAxis
      sampleSize={trips}
      legend={
        <ChartLegend
          items={[
            { label: COPY.perTrip.warning, color: STATUS_COLORS.warning, mark: 'bar', icon: <Ic n="warn" s={LEGEND_ICON_SIZE} /> },
            { label: COPY.perTrip.critical, color: STATUS_COLORS.critical, mark: 'bar', icon: <Ic n="siren" s={LEGEND_ICON_SIZE} /> },
          ]}
        />
      }
      {...queryState(problems)}
      isEmpty={trips === 0}
      emptyBody={COPY.noTrips}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendColumns<ProblemsPerTripBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.problems}
        series={[
          { key: 'warning', label: COPY.perTrip.warning, color: STATUS_COLORS.warning, value: (row) => row.warning_count },
          { key: 'critical', label: COPY.perTrip.critical, color: STATUS_COLORS.critical, value: (row) => row.critical_count },
        ]}
        renderTooltip={(row) => {
          const total = row.warning_count + row.critical_count
          return (
            <ChartTooltip
              title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
              lines={[
                { value: String(row.warning_count), label: COPY.perTrip.warning, color: STATUS_COLORS.warning },
                { value: String(row.critical_count), label: COPY.perTrip.critical, color: STATUS_COLORS.critical },
              ]}
              note={COPY.perTrip.tooltip(total, row.trip_count, fmtPerTrip(total, row.trip_count))}
            />
          )
        }}
      />
    </ChartCard>
  )
}

/** Chart 3.2: is theft risk going up? One line (the total); each type is in the tooltip and
 *  has its own table column. */
function TheftCard({ problems, grain, today }: TabCardProps) {
  const rows = problems.data?.theft_signals ?? []
  const trips = sumOf(problems.data?.per_trip ?? [], (row) => row.trip_count)
  const total = sumOf(rows, (row) => row.total_count)
  // The backend sends every theft-sign type, zeros included, in one stable order.
  const types = Object.keys(rows[0]?.by_type ?? {})
  type TheftRow = Record<string, string | number>
  const tableRows: TheftRow[] = rows.map((row) => ({
    period: fmtBucketName(row.bucket_start, row.is_partial, grain, today),
    ...row.by_type,
    total: row.total_count,
  }))
  const columns: Column<TheftRow>[] = [
    { key: 'period', label: FLEET_COPY.controls.grainLabels[grain] },
    ...types.map((type) => ({ key: type, label: fmtExceptionType(type) })),
    { key: 'total', label: COPY.theft.total },
  ]

  return (
    <ChartCard
      title={COPY.theft.title}
      question={COPY.theft.question}
      basis={COPY.theft.basis(total)}
      sampleSize={trips}
      timeAxis
      {...queryState(problems)}
      isEmpty={trips === 0}
      emptyBody={COPY.noTrips}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <TrendLines<TheftSignalsBucket>
        rows={rows}
        rowKey={(row) => row.bucket_start}
        tickLabel={(key) => fmtBucketLabel(key, grain)}
        isPartial={(row) => row.is_partial}
        yLabel={COPY.axis.theftSigns}
        series={[{ key: 'total', label: COPY.theft.total, color: SERIES_COLORS[0], value: (row) => row.total_count }]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={fmtBucketName(row.bucket_start, row.is_partial, grain, today)}
            lines={[
              { value: String(row.total_count), label: COPY.theft.lower, color: SERIES_COLORS[0] },
              ...types.map((type) => ({ value: String(row.by_type[type] ?? 0), label: fmtExceptionType(type) })),
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface TypeRow {
  type: ExceptionType
  label: string
  system: number
  driver: number
  dispatcher: number
  total: number
}

/** One row per problem type, split by who raised it, biggest first (chart 3.3). */
function pivotByType(counts: FleetProblems['by_type']): TypeRow[] {
  const rows = new Map<ExceptionType, TypeRow>()
  for (const { exception_type: type, source, count } of counts) {
    const row = rows.get(type) ?? {
      type, label: fmtExceptionType(type), system: 0, driver: 0, dispatcher: 0, total: 0,
    }
    row[source] += count
    row.total += count
    rows.set(type, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

/** Chart 3.3: which problems happen most? Only types that actually happened, so a type
 *  nothing creates never sits at a reassuring zero. */
function ByTypeCard({ problems }: { problems: FleetQueryResult<FleetProblems> }) {
  const rows = pivotByType(problems.data?.by_type ?? [])
  const total = sumOf(rows, (row) => row.total)
  const columns: Column<TypeRow>[] = [
    { key: 'label', label: COPY.byType.type },
    ...SOURCES.map((source) => ({ key: source, label: COPY.byType.sources[source] })),
    { key: 'total', label: COPY.byType.total },
  ]

  return (
    <ChartCard
      title={COPY.byType.title}
      question={COPY.byType.question}
      basis={COPY.byType.basis(total)}
      legend={
        <ChartLegend
          items={SOURCES.map((source, index) => ({ label: COPY.byType.sources[source], color: SERIES_COLORS[index], mark: 'bar' }))}
        />
      }
      {...queryState(problems)}
      isEmpty={rows.length === 0}
      emptyBody={COPY.byType.empty}
      table={<DataTable columns={columns} rows={rows} />}
    >
      <CategoryBars<TypeRow>
        orientation="bars"
        rows={rows}
        rowKey={(row) => row.type}
        categoryLabel={(row) => row.label}
        yLabel={COPY.axis.problems}
        series={SOURCES.map((source, index) => ({
          key: source, label: COPY.byType.sources[source], color: () => SERIES_COLORS[index], value: (row: TypeRow) => row[source],
        }))}
        renderTooltip={(row) => (
          <ChartTooltip
            title={row.label}
            lines={[
              { value: String(row.total), label: COPY.byType.total.toLowerCase() },
              ...SOURCES.map((source, index) => ({ value: String(row[source]), label: COPY.byType.sources[source], color: SERIES_COLORS[index] })),
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface StepRow {
  step: string
  count: number
}

/** Chart 3.4: at which step do problems happen? Plan order, "not linked" last. */
function ByStepCard({ problems }: { problems: FleetQueryResult<FleetProblems> }) {
  const steps: ProblemStepCount[] = (problems.data?.by_step ?? []).filter(
    (row) => !OPTIONAL_STEPS.has(row.step) || row.count > 0,
  )
  const total = sumOf(steps, (row) => row.count)
  const label = (step: string): string => COPY.byStep.steps[step] ?? step
  const tableRows: StepRow[] = steps.map((row) => ({ step: label(row.step), count: row.count }))
  const columns: Column<StepRow>[] = [
    { key: 'step', label: COPY.byStep.step },
    { key: 'count', label: COPY.axis.problems },
  ]

  return (
    <ChartCard
      title={COPY.byStep.title}
      question={COPY.byStep.question}
      basis={COPY.byStep.basis(total)}
      {...queryState(problems)}
      isEmpty={total === 0}
      emptyBody={COPY.byStep.empty}
      table={<DataTable columns={columns} rows={tableRows} />}
    >
      <CategoryBars<ProblemStepCount>
        orientation="columns"
        rows={steps}
        rowKey={(row) => row.step}
        categoryLabel={(row) => label(row.step)}
        yLabel={COPY.axis.problems}
        series={[{ key: 'count', label: COPY.axis.problems, color: () => SERIES_COLORS[0], value: (row) => row.count }]}
        renderTooltip={(row) => (
          <ChartTooltip title={label(row.step)} lines={[{ value: String(row.count), label: COPY.axis.problems.toLowerCase(), color: SERIES_COLORS[0] }]} />
        )}
      />
    </ChartCard>
  )
}

interface RiskyRow {
  block: string
  driving: string
  drivingShare: string
  problems: number
  problemShare: string
}

/** Chart 3.5: is any time of day riskier than its share of driving? Two columns per block,
 *  side by side: comparing the two shares is the whole point. */
function RiskyTimesCard({ problems }: { problems: FleetQueryResult<FleetProblems> }) {
  const blocks = problems.data?.risky_times ?? []
  const drivingMinutes = sumOf(blocks, (row) => row.driving_minutes)
  const roadProblems = sumOf(blocks, (row) => row.road_problem_count)
  const [DRIVING_COLOR, PROBLEM_COLOR] = SERIES_COLORS
  const tableRows: RiskyRow[] = blocks.map((row) => ({
    block: COPY.risky.blocks[row.block],
    driving: fmtMinutes(row.driving_minutes),
    drivingShare: fmtShare(row.driving_share),
    problems: row.road_problem_count,
    problemShare: fmtShare(row.road_problem_share),
  }))
  const columns: Column<RiskyRow>[] = [
    { key: 'block', label: COPY.risky.columns.block },
    { key: 'driving', label: COPY.risky.columns.driving },
    { key: 'drivingShare', label: COPY.risky.columns.drivingShare },
    { key: 'problems', label: COPY.risky.columns.problems },
    { key: 'problemShare', label: COPY.risky.columns.problemShare },
  ]

  return (
    <ChartCard
      title={COPY.risky.title}
      question={COPY.risky.question}
      basis={COPY.risky.basis(fmtMinutes(drivingMinutes), roadProblems)}
      note={COPY.risky.note}
      legend={
        <ChartLegend
          items={[
            { label: COPY.risky.drivingShare, color: DRIVING_COLOR, mark: 'bar' },
            { label: COPY.risky.problemShare, color: PROBLEM_COLOR, mark: 'bar' },
          ]}
        />
      }
      {...queryState(problems)}
      isEmpty={drivingMinutes === 0 && roadProblems === 0}
      emptyBody={COPY.risky.empty}
      table={
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-on-surf-v">{COPY.risky.caveat}</p>
          <DataTable columns={columns} rows={tableRows} />
        </div>
      }
    >
      <CategoryBars<RiskyTimeBlock>
        orientation="columns"
        stacked={false}
        rows={blocks}
        rowKey={(row) => row.block}
        categoryLabel={(row) => COPY.risky.blocks[row.block]}
        yLabel={COPY.axis.share}
        series={[
          { key: 'driving', label: COPY.risky.drivingShare, color: () => DRIVING_COLOR, value: (row) => (row.driving_share ?? 0) * PERCENT },
          { key: 'problems', label: COPY.risky.problemShare, color: () => PROBLEM_COLOR, value: (row) => (row.road_problem_share ?? 0) * PERCENT },
        ]}
        renderTooltip={(row) => (
          <ChartTooltip
            title={COPY.risky.blocks[row.block]}
            lines={[
              { value: fmtShare(row.driving_share), label: `${COPY.risky.drivingShare} (${fmtMinutes(row.driving_minutes)})`, color: DRIVING_COLOR },
              { value: fmtShare(row.road_problem_share), label: `${COPY.risky.problemShare} (${row.road_problem_count})`, color: PROBLEM_COLOR },
            ]}
          />
        )}
      />
    </ChartCard>
  )
}

interface ProblemsTabProps {
  query: TabQuery
  allTimeStart: string | null
  today: string
}

/** Problems tab. One request for all five charts, over the closed-trip set; dispatcher notes
 *  never counted. */
export function ProblemsTab({ query, allTimeStart, today }: ProblemsTabProps) {
  const problems = useFleetProblems(query, allTimeStart)
  const grain = problems.data?.period.grain ?? query.grain

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-on-surf-v">{COPY.tabNote}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PerTripCard problems={problems} grain={grain} today={today} />
        <TheftCard problems={problems} grain={grain} today={today} />
        <ByTypeCard problems={problems} />
        <ByStepCard problems={problems} />
        <RiskyTimesCard problems={problems} />
      </div>
    </div>
  )
}
