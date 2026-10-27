'use client'

import type { ReactNode } from 'react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'

import { GRID_COLOR, SURFACE_COLOR, TICK_COLOR } from '@/lib/tokens'
import { useChartHeight } from '../ChartZoom'
import {
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
  cornerLabel: string
  height?: number
}

const KEY = '__key'

interface ScatterDatum {
  [KEY]: string
  x: number
  y: number
}

interface DotShapeProps {
  cx?: number
  cy?: number
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** One dot per lane, one series. Two faint lines at the average lane split the chart into four
 *  corners, and the top-right one is named for what it holds. Dots carry no written names: a
 *  lane's name ("Cape Town Depot (Epping) → Johannesburg Depot (Linbro)") is too long to sit
 *  beside a dot without running off the chart, so it shows on hover, and every lane is named in
 *  the table. Each dot sits on a transparent 24px target, so hovering needs no precision. */
export function LaneScatter<Row>({
  rows, rowKey, x, y, renderTooltip, xLabel, yLabel, color, cornerLabel, height: normalHeight = CHART_HEIGHT,
}: LaneScatterProps<Row>) {
  const height = useChartHeight(normalHeight)
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const points = rows.map((row) => ({ row, x: x(row), y: y(row) }))
  const hasAverages = points.length >= MIN_DOTS_FOR_AVERAGES
  const averageX = hasAverages ? mean(points.map((point) => point.x)) : null
  const averageY = hasAverages ? mean(points.map((point) => point.y)) : null
  const data: ScatterDatum[] = points.map((point) => ({ [KEY]: rowKey(point.row), x: point.x, y: point.y }))

  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%" minHeight={height}>
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
          {averageX !== null && <ReferenceLine x={averageX} stroke={TICK_COLOR} />}
          {averageY !== null && <ReferenceLine y={averageY} stroke={TICK_COLOR} />}
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
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
            shape={({ cx, cy }: DotShapeProps) => (
              <g>
                <circle cx={cx} cy={cy} r={SCATTER_HIT_RADIUS} fill="transparent" />
                <circle cx={cx} cy={cy} r={SCATTER_DOT_RADIUS} fill={color} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH} />
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
