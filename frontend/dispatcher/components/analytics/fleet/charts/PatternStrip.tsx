'use client'

import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA } from '@/lib/format/analytics'
import { MONTH_ABBREVIATIONS } from '@/lib/format/month'
import { weekdayName } from '@/lib/format/period'
import { GRID_COLOR, NEUTRAL_COLOR, SERIES_COLORS, SURFACE_COLOR } from '@/lib/tokens'
import type { PatternBar, PatternSet } from '@shared/lib/types/fleet-analytics'
import { useChartHeight } from '../ChartZoom'
import { ChartCard } from '../ChartCard'
import { FLEET_COPY } from '../copy'
import { ChartTooltip } from './ChartTooltip'
import {
  AXIS_TICK,
  BAR_MAX_SIZE,
  CHART_MARGIN,
  CURSOR_OPACITY,
  GAP_WIDTH,
  MIN_TICK_GAP,
  PATTERN_CHART_HEIGHT,
  ROUNDED_TOP,
  Y_AXIS_WIDTH,
  yAxisHeading,
} from './chartStyle'

const COPY = FLEET_COPY.activity.patterns
// Averages under 10 need two decimals to tell 0.14 from 0.43; bigger ones only one.
const SMALL_AVERAGE = 10
const HOUR_DIGITS = 2
const WEEKDAY_ABBREVIATION_LENGTH = 3

type Dimension = keyof PatternSet

interface DimensionSpec {
  id: Dimension
  title: string
  column: string
  tick: (key: number) => string
  name: (key: number) => string
}

const pad = (hour: number): string => String(hour).padStart(HOUR_DIGITS, '0')

// Clock and calendar order, never sorted by size (spec §5.1).
const DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'hour_of_day', ...COPY.dimensions.hour_of_day, tick: String, name: (key) => `${pad(key)}:00–${pad(key + 1)}:00` },
  {
    id: 'weekday', ...COPY.dimensions.weekday,
    tick: (key) => weekdayName(key).slice(0, WEEKDAY_ABBREVIATION_LENGTH), name: weekdayName,
  },
  { id: 'day_of_month', ...COPY.dimensions.day_of_month, tick: String, name: (key) => COPY.dayOfMonth(key) },
  {
    id: 'month_of_year', ...COPY.dimensions.month_of_year,
    tick: (key) => MONTH_ABBREVIATIONS[key - 1], name: (key) => MONTH_ABBREVIATIONS[key - 1],
  },
]

export function fmtAverage(average: number | null): string {
  if (average === null) return NO_DATA
  return average < SMALL_AVERAGE ? average.toFixed(2) : average.toFixed(1)
}

/** The bar drawn in the accent: the highest average, the earliest one on a tie. null when
 *  nothing happened, so an empty chart has no false "busiest". */
export function busiestKey(bars: readonly PatternBar[]): number | null {
  let best: PatternBar | null = null
  for (const bar of bars) {
    if (bar.average_per_day !== null && bar.average_per_day > 0 && (best === null || bar.average_per_day > (best.average_per_day ?? 0))) {
      best = bar
    }
  }
  return best?.key ?? null
}

interface PatternColumnsProps {
  bars: readonly PatternBar[]
  spec: DimensionSpec
  renderTooltip: (bar: PatternBar) => ReactNode
  yLabel: string
}

/** One small column chart. Emphasis form: the busiest bar in the accent, the rest in the
 *  neutral grey, so the eye goes to the peak without the bars being reordered. */
function PatternColumns({ bars, spec, renderTooltip, yLabel }: PatternColumnsProps) {
  // Taller inside the zoom modal (D27).
  const height = useChartHeight(PATTERN_CHART_HEIGHT)
  const busiest = busiestKey(bars)
  const byKey = new Map(bars.map((bar) => [String(bar.key), bar]))
  const data = bars.map((bar) => ({ key: String(bar.key), value: bar.average_per_day ?? 0 }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey="key" tickFormatter={(key: string) => spec.tick(Number(key))} tick={AXIS_TICK}
          tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval="preserveStartEnd" minTickGap={MIN_TICK_GAP}
        />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={Y_AXIS_WIDTH} label={yAxisHeading(yLabel)} />
        <Tooltip
          cursor={{ fill: GRID_COLOR, fillOpacity: CURSOR_OPACITY }}
          content={({ active, label }) => {
            const bar = active && label !== undefined ? byKey.get(String(label)) : undefined
            return bar === undefined ? null : renderTooltip(bar)
          }}
        />
        <Bar dataKey="value" maxBarSize={BAR_MAX_SIZE} radius={ROUNDED_TOP} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH} isAnimationActive={false}>
          {bars.map((bar) => (
            <Cell key={bar.key} fill={bar.key === busiest ? SERIES_COLORS[0] : NEUTRAL_COLOR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

interface PatternRow {
  label: string
  events: number
  days: number
  average: string
}

const TABLE_COLUMNS = (column: string): Column<PatternRow>[] => [
  { key: 'label', label: column },
  { key: 'events', label: COPY.table.events },
  { key: 'days', label: COPY.table.days },
  { key: 'average', label: COPY.table.average },
]

interface PatternStripProps {
  set: PatternSet | null
  /** "departures" or "arrivals", for the words around the numbers. */
  eventNoun: string
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  onRetry: () => void
  /** Shown under the month chart when the period is under a year. */
  monthNote?: string
  /** The y-axis heading of all four charts, e.g. "Avg per day" (spec §7.7). */
  yLabel: string
}

/** The row of four busy-pattern charts (chart 1.3): hour of day, weekday, day of month,
 *  month of year. Each has its own card, so each has its own table view. */
export function PatternStrip({ set, eventNoun, isLoading, isRefreshing, error, onRetry, monthNote, yLabel }: PatternStripProps) {
  const total = set === null ? 0 : set.hour_of_day.reduce((sum, bar) => sum + bar.event_count, 0)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {DIMENSIONS.map((spec) => {
        const bars = set?.[spec.id] ?? []
        const rows: PatternRow[] = bars.map((bar) => ({
          label: spec.name(bar.key), events: bar.event_count, days: bar.day_count, average: fmtAverage(bar.average_per_day),
        }))
        return (
          <ChartCard
            key={spec.id}
            title={spec.title}
            question={COPY.question(eventNoun)}
            basis={COPY.basis(total, eventNoun)}
            caveat={spec.id === 'month_of_year' ? monthNote : undefined}
            isLoading={isLoading}
            isRefreshing={isRefreshing}
            error={error}
            onRetry={onRetry}
            isEmpty={total === 0}
            emptyBody={COPY.empty(eventNoun)}
            chartHeight={PATTERN_CHART_HEIGHT}
            table={<DataTable columns={TABLE_COLUMNS(spec.column)} rows={rows} />}
          >
            <PatternColumns
              bars={bars}
              spec={spec}
              yLabel={yLabel}
              renderTooltip={(bar) => (
                <ChartTooltip
                  title={spec.name(bar.key)}
                  lines={[{ value: COPY.perDay(fmtAverage(bar.average_per_day)), label: COPY.onAverage, color: SERIES_COLORS[0] }]}
                  note={COPY.over(bar.event_count, eventNoun, bar.day_count)}
                />
              )}
            />
          </ChartCard>
        )
      })}
    </div>
  )
}
