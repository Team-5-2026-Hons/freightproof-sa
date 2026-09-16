'use client'

import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type XAxisTickContentProps } from 'recharts'

import { GRID_COLOR, SURFACE_COLOR, TICK_COLOR } from '@/lib/tokens'
import { labelWidthFor, renderTimeTick } from './axisTicks'
import {
  AXIS_TICK,
  BAR_MAX_SIZE,
  CHART_HEIGHT,
  CURSOR_OPACITY,
  GAP_WIDTH,
  PARTIAL_OPACITY,
  ROUNDED_TOP,
  TICK_MARK_SIZE,
  TIME_CHART_MARGIN,
  Y_AXIS_WIDTH,
  yAxisHeading,
} from './chartStyle'

export interface ColumnSeries<Row> {
  key: string
  label: string
  color: string
  value: (row: Row) => number
}

interface TrendColumnsProps<Row> {
  rows: readonly Row[]
  /** The bucket's key (its first day); also what the tooltip looks the row up by. */
  rowKey: (row: Row) => string
  tickLabel: (key: string) => string
  isPartial: (row: Row) => boolean
  /** Stacked bottom to top, in slot order. */
  series: readonly ColumnSeries<Row>[]
  renderTooltip: (row: Row) => ReactNode
  /** The y-axis heading, e.g. "Trips". Required: every chart names its value axis (spec §7.7). */
  yLabel: string
  height?: number
}

// Internal keys, prefixed so no series key can collide with them.
const KEY = '__key'
const PARTIAL = '__partial'

type Datum = Record<string, string | number | boolean>

/** Stacked columns over time (charts 1.1, 2.3, 3.1, 5.1). Thin Recharts wrapper applying
 *  spec §7.4: bars at most 24 px, a 2 px surface gap between segments, only the top
 *  segment rounded, partial buckets faded, one y-axis, a hairline grid. */
export function TrendColumns<Row>({
  rows, rowKey, tickLabel, isPartial, series, renderTooltip, yLabel, height = CHART_HEIGHT,
}: TrendColumnsProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const labelWidth = labelWidthFor(rows.map((row) => tickLabel(rowKey(row))))
  const data: Datum[] = rows.map((row) => ({
    [KEY]: rowKey(row),
    [PARTIAL]: isPartial(row),
    ...Object.fromEntries(series.map((item) => [item.key, item.value(row)])),
  }))
  const topIndex = series.length - 1

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={TIME_CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey={KEY} interval={0} tickLine={{ stroke: TICK_COLOR }} tickSize={TICK_MARK_SIZE}
          axisLine={{ stroke: GRID_COLOR }}
          tick={(props: XAxisTickContentProps) => renderTimeTick(props, tickLabel, rows.length, labelWidth)}
        />
        <YAxis
          allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={Y_AXIS_WIDTH}
          label={yAxisHeading(yLabel)}
        />
        <Tooltip
          cursor={{ fill: GRID_COLOR, fillOpacity: CURSOR_OPACITY }}
          content={({ active, label }) => {
            const row = active && label !== undefined ? byKey.get(String(label)) : undefined
            return row === undefined ? null : renderTooltip(row)
          }}
        />
        {series.map((item, index) => (
          <Bar
            key={item.key} dataKey={item.key} name={item.label} stackId="stack" fill={item.color}
            stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH} maxBarSize={BAR_MAX_SIZE}
            radius={index === topIndex ? ROUNDED_TOP : 0} isAnimationActive={false}
          >
            {data.map((datum) => (
              <Cell key={String(datum[KEY])} fillOpacity={datum[PARTIAL] === true ? PARTIAL_OPACITY : 1} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
