'use client'

import type { ReactNode } from 'react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_TEXT_COLOR, GRID_COLOR, SURFACE_COLOR, TICK_COLOR } from '@/lib/tokens'
import {
  AXIS_FONT_SIZE,
  AXIS_TICK,
  CHART_HEIGHT,
  CHART_MARGIN,
  GAP_WIDTH,
  SCATTER_DOT_RADIUS,
  SCATTER_HIT_RADIUS,
  X_AXIS_WITH_HEADING_HEIGHT,
  Y_AXIS_WIDTH,
  xAxisHeading,
  yAxisHeading,
} from './chartStyle'

// With this many dots or fewer every dot is named; past it, only the busy-and-risky ones, so
// the names never pile into an unreadable heap.
const MAX_NAMED_DOTS = 6
// A name sits this far from its dot, on the side with more room.
const DOT_LABEL_OFFSET_PX = 12
// An average needs at least two dots to split them into anything.
const MIN_DOTS_FOR_AVERAGES = 2

interface LaneScatterProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  x: (row: Row) => number
  y: (row: Row) => number
  renderTooltip: (row: Row) => ReactNode
  xLabel: string
  yLabel: string
  color: string
  /** A dot's name, written beside it. */
  pointLabel: (row: Row) => string
  /** Written in the top-right corner, e.g. "Busy and risky". */
  cornerLabel: string
  height?: number
}

const KEY = '__key'

interface ScatterDatum {
  [KEY]: string
  x: number
  y: number
  /** null when this dot goes unnamed (see MAX_NAMED_DOTS). */
  label: string | null
  /** Right of the average: its name goes on its left, where there is room. */
  rightOfAverage: boolean
}

interface DotShapeProps {
  cx?: number
  cy?: number
  payload?: ScatterDatum
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** One dot per lane, one series. Each dot is named, two faint lines at the average lane split
 *  the chart into four corners, and the top-right one is named for what it holds. Each dot
 *  sits on a transparent 24px target, so hovering needs no precision. */
export function LaneScatter<Row>({
  rows, rowKey, x, y, renderTooltip, xLabel, yLabel, color, pointLabel, cornerLabel, height = CHART_HEIGHT,
}: LaneScatterProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const points = rows.map((row) => ({ row, x: x(row), y: y(row) }))
  const hasAverages = points.length >= MIN_DOTS_FOR_AVERAGES
  const averageX = hasAverages ? mean(points.map((point) => point.x)) : null
  const averageY = hasAverages ? mean(points.map((point) => point.y)) : null
  const nameEvery = points.length <= MAX_NAMED_DOTS
  const data: ScatterDatum[] = points.map((point) => {
    const busyAndRisky = averageX !== null && averageY !== null && point.x >= averageX && point.y >= averageY
    return {
      [KEY]: rowKey(point.row),
      x: point.x,
      y: point.y,
      label: nameEvery || busyAndRisky ? pointLabel(point.row) : null,
      rightOfAverage: averageX !== null && point.x > averageX,
    }
  })

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} />
          <XAxis
            type="number" dataKey="x" allowDecimals={false} tick={AXIS_TICK} tickLine={false}
            axisLine={{ stroke: GRID_COLOR }} height={X_AXIS_WITH_HEADING_HEIGHT} label={xAxisHeading(xLabel)}
          />
          <YAxis
            type="number" dataKey="y" tick={AXIS_TICK} tickLine={false} axisLine={false}
            width={Y_AXIS_WIDTH} label={yAxisHeading(yLabel)}
          />
          {/* Solid hairlines, one step darker than the grid: dashes would read as a target. */}
          {averageX !== null && <ReferenceLine x={averageX} stroke={TICK_COLOR} />}
          {averageY !== null && <ReferenceLine y={averageY} stroke={TICK_COLOR} />}
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              // The hovered point's own datum: its key finds the typed row.
              const datum = payload?.[0]?.payload as Partial<ScatterDatum> | undefined
              const key = datum?.[KEY]
              const row = active && typeof key === 'string' ? byKey.get(key) : undefined
              return row === undefined ? null : renderTooltip(row)
            }}
          />
          <Scatter
            data={data}
            fill={color}
            isAnimationActive={false}
            shape={({ cx, cy, payload }: DotShapeProps) => (
              <g>
                <circle cx={cx} cy={cy} r={SCATTER_HIT_RADIUS} fill="transparent" />
                <circle cx={cx} cy={cy} r={SCATTER_DOT_RADIUS} fill={color} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH} />
                {payload?.label != null && cx !== undefined && cy !== undefined && (
                  <text
                    x={payload.rightOfAverage ? cx - DOT_LABEL_OFFSET_PX : cx + DOT_LABEL_OFFSET_PX}
                    y={cy}
                    dy="0.35em"
                    textAnchor={payload.rightOfAverage ? 'end' : 'start'}
                    fontSize={AXIS_FONT_SIZE}
                    fill={AXIS_TEXT_COLOR}
                  >
                    {payload.label}
                  </text>
                )}
              </g>
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>
      {hasAverages && (
        <span className="pointer-events-none absolute right-4 top-2 text-[11px] font-[600] text-on-surf-v">
          {cornerLabel}
        </span>
      )}
    </div>
  )
}
