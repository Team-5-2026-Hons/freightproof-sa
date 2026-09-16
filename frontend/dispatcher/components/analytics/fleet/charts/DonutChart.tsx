'use client'

import type { ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { SURFACE_COLOR } from '@/lib/tokens'
import { CHART_HEIGHT, GAP_WIDTH } from './chartStyle'

// A ring rather than a full pie, so the total can sit in the middle.
const INNER_RADIUS = '58%'
const OUTER_RADIUS = '82%'
// Start at twelve o'clock and run clockwise, the way people read a clock face.
const START_ANGLE = 90
const END_ANGLE = -270

interface DonutDatum {
  key: string
  value: number
  color: string
}

interface DonutChartProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  value: (row: Row) => number
  /** Per row, and fixed per category: colour follows the category, never its size or rank. */
  color: (row: Row) => string
  /** Written in the hole, e.g. "5 reviews". */
  centre: string
  renderTooltip: (row: Row) => ReactNode
  height?: number
}

/** Parts of one whole, up to six of them. Zero parts are left out of the ring (they would
 *  draw nothing) but stay in the legend and the table. */
export function DonutChart<Row>({
  rows, rowKey, value, color, centre, renderTooltip, height = CHART_HEIGHT,
}: DonutChartProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const data: DonutDatum[] = rows
    .filter((row) => value(row) > 0)
    .map((row) => ({ key: rowKey(row), value: value(row), color: color(row) }))

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip
            content={({ active, payload }) => {
              // The hovered slice's own datum: its key finds the typed row.
              const datum = payload?.[0]?.payload as Partial<DonutDatum> | undefined
              const row = active && typeof datum?.key === 'string' ? byKey.get(datum.key) : undefined
              return row === undefined ? null : renderTooltip(row)
            }}
          />
          <Pie
            data={data} dataKey="value" nameKey="key" innerRadius={INNER_RADIUS} outerRadius={OUTER_RADIUS}
            startAngle={START_ANGLE} endAngle={END_ANGLE} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH}
            isAnimationActive={false}
          >
            {data.map((datum) => <Cell key={datum.key} fill={datum.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-[600] text-on-surf">
        {centre}
      </div>
    </div>
  )
}
