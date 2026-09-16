'use client'

import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { GRID_COLOR, SURFACE_COLOR, TICK_COLOR } from '@/lib/tokens'
import { AXIS_TICK, BAR_MAX_SIZE, CHART_HEIGHT, CURSOR_OPACITY, GAP_WIDTH, ROUNDED_TOP } from './chartStyle'

/** Room for the middle axis's tick numbers, between the left half's columns and the axis line. */
export const MIDDLE_AXIS_WIDTH = 32
// The shared count axis aims for about this many intervals, each rounded to 1, 2 or 5 × 10ⁿ.
const TARGET_TICK_INTERVALS = 4
const NICE_STEPS = [1, 2, 5, 10] as const
const DECIMAL_BASE = 10
// Equal top and bottom margins on both halves, so their baselines and gridlines line up.
const LEFT_HALF_MARGIN = { top: 8, right: 0, bottom: 0, left: 8 } as const
const RIGHT_HALF_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const

const KEY = '__key'
const VALUE = '__value'

type Datum = Record<string, string | number>

/** Whole-number ticks from 0 that both halves share, so their gridlines meet exactly at the
 *  middle axis: 0, 5, 10, 15, 20 when the tallest column is 16. */
export function countTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / TARGET_TICK_INTERVALS
  const magnitude = DECIMAL_BASE ** Math.floor(Math.log10(raw))
  const nice = NICE_STEPS.find((step) => step * magnitude >= raw) ?? DECIMAL_BASE
  // Counts are whole trips: never a step below 1.
  const step = Math.max(1, nice * magnitude)
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
}

interface HalfProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  categoryLabel: (row: Row) => string
  value: (row: Row) => number
  color: string
  ticks: number[]
  /** Only the right half draws the axis: on its left edge, which is the middle of the chart. */
  showAxis: boolean
  renderTooltip: (row: Row) => ReactNode
  height: number
}

function Half<Row>({ rows, rowKey, categoryLabel, value, color, ticks, showAxis, renderTooltip, height }: HalfProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const labels = new Map(rows.map((row) => [rowKey(row), categoryLabel(row)]))
  const data: Datum[] = rows.map((row) => ({ [KEY]: rowKey(row), [VALUE]: value(row) }))
  const top = ticks[ticks.length - 1]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={showAxis ? RIGHT_HALF_MARGIN : LEFT_HALF_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey={KEY} tickFormatter={(key: string) => labels.get(key) ?? key} tick={AXIS_TICK}
          tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval={0}
        />
        {/* Both halves get the same domain and ticks; the left one hides its copy. */}
        <YAxis
          hide={!showAxis} domain={[0, top]} ticks={ticks} allowDecimals={false} width={MIDDLE_AXIS_WIDTH}
          tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: TICK_COLOR }}
        />
        <Tooltip
          cursor={{ fill: GRID_COLOR, fillOpacity: CURSOR_OPACITY }}
          content={({ active, label }) => {
            const row = active && label !== undefined ? byKey.get(String(label)) : undefined
            return row === undefined ? null : renderTooltip(row)
          }}
        />
        <Bar
          dataKey={VALUE} fill={color} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH}
          maxBarSize={BAR_MAX_SIZE} radius={ROUNDED_TOP} isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface SplitColumnsProps<Row> {
  /** Drawn left of the middle axis, in the order given (furthest from it first). */
  left: readonly Row[]
  /** Drawn right of the middle axis, in the order given (nearest to it first). */
  right: readonly Row[]
  rowKey: (row: Row) => string
  categoryLabel: (row: Row) => string
  value: (row: Row) => number
  leftColor: string
  rightColor: string
  /** The count axis's heading, written level above the middle axis. */
  yLabel: string
  /** Under the middle axis, e.g. "On plan". */
  centreLabel: string
  leftCaption: string
  rightCaption: string
  renderTooltip: (row: Row) => ReactNode
  height?: number
}

/** Columns either side of a y-axis drawn down the middle: two half charts on one shared count
 *  scale, both growing up from one baseline. Built from two ordinary bar charts rather than a
 *  custom axis, so every mark follows the same rules as the other charts. */
export function SplitColumns<Row>({
  left, right, rowKey, categoryLabel, value, leftColor, rightColor, yLabel, centreLabel,
  leftCaption, rightCaption, renderTooltip, height = CHART_HEIGHT,
}: SplitColumnsProps<Row>) {
  const ticks = countTicks(Math.max(0, ...left.map(value), ...right.map(value)))
  // The axis line is the right half's plot edge: half-way across, plus the tick numbers' width.
  const onAxis = { left: `calc(50% + ${MIDDLE_AXIS_WIDTH}px)` }
  const shared = { rowKey, categoryLabel, value, ticks, renderTooltip, height }

  return (
    <div>
      <div className="relative h-4 text-[11px] text-on-surf-v">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={onAxis}>{yLabel}</span>
      </div>
      <div className="flex">
        <div className="min-w-0 flex-1">
          <Half<Row> {...shared} rows={left} color={leftColor} showAxis={false} />
        </div>
        <div className="min-w-0 flex-1">
          <Half<Row> {...shared} rows={right} color={rightColor} showAxis />
        </div>
      </div>
      <div className="relative mt-1 h-5 text-[12px] text-on-surf-v">
        <span className="absolute left-0">{leftCaption}</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={onAxis}>{centreLabel}</span>
        <span className="absolute right-0">{rightCaption}</span>
      </div>
    </div>
  )
}
