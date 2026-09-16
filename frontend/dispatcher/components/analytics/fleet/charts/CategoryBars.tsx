'use client'

import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_TEXT_COLOR, GRID_COLOR, SURFACE_COLOR } from '@/lib/tokens'
import {
  AXIS_FONT_SIZE,
  AXIS_TICK,
  BAR_MAX_SIZE,
  BAR_ROW_HEIGHT,
  CATEGORY_AXIS_WIDTH,
  CATEGORY_LINE_HEIGHT,
  CATEGORY_TICK_PADDING,
  CHART_HEIGHT,
  CHART_MARGIN,
  CURSOR_OPACITY,
  GAP_WIDTH,
  ROUNDED_RIGHT,
  ROUNDED_TOP,
  X_AXIS_WITH_HEADING_HEIGHT,
  Y_AXIS_WIDTH,
  xAxisHeading,
  yAxisHeading,
} from './chartStyle'

export interface BarSeries<Row> {
  key: string
  label: string
  /** Per row, so one series can colour its bars by what they are (lateness bands, severity). */
  color: (row: Row) => string
  value: (row: Row) => number
  /** Fades a bar that rests on too little to compare fairly (chart 2.4's short lanes). */
  opacity?: (row: Row) => number
}

interface CategoryBarsProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  categoryLabel: (row: Row) => string
  /** Stacked in order; the last one gets the rounded data end. */
  series: readonly BarSeries<Row>[]
  renderTooltip: (row: Row) => ReactNode
  /** The value-axis heading (spec §7.7). Named yLabel like every wrapper's; on horizontal bars
   *  the value axis is the x-axis, so it is drawn there. */
  yLabel: string
  /** 'columns' stand up from the baseline (2.2); 'bars' lie along it, for long category names
   *  (3.3, 4.4, 5.4, 1.6). */
  orientation: 'columns' | 'bars'
  /** Stacked adds the series up (parts of one total); side by side compares them (chart 3.5).
   *  Defaults to stacked. */
  stacked?: boolean
  height?: number
  /** Horizontal bars only: room for the category names, and each row's height. Long names
   *  (chart 2.4's lanes) want a wider column and taller rows, so they wrap onto spaced lines
   *  instead of piling onto the next row. */
  categoryAxisWidth?: number
  rowHeight?: number
  /** Space between one category's bars and the next, as Recharts' barCategoryGap. */
  categoryGap?: string
}

const KEY = '__key'

type Datum = Record<string, string | number>

interface CategoryTickProps {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
}

/** Bars over fixed categories rather than time. Categories keep the order the rows come in:
 *  bands stay in lateness order, and a ranked list stays ranked. Same mark rules as the trend
 *  charts: at most 24 px, a 2 px surface gap, a rounded data end, a hairline grid. */
export function CategoryBars<Row>({
  rows, rowKey, categoryLabel, series, renderTooltip, yLabel, orientation, stacked = true, height,
  categoryAxisWidth = CATEGORY_AXIS_WIDTH, rowHeight = BAR_ROW_HEIGHT, categoryGap,
}: CategoryBarsProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const labels = new Map(rows.map((row) => [rowKey(row), categoryLabel(row)]))
  const data: Datum[] = rows.map((row) => ({
    [KEY]: rowKey(row),
    ...Object.fromEntries(series.map((item) => [item.key, item.value(row)])),
  }))
  const isBars = orientation === 'bars'
  const lastIndex = series.length - 1
  const chartHeight = height ?? (isBars ? rows.length * rowHeight + X_AXIS_WITH_HEADING_HEIGHT : CHART_HEIGHT)
  const tickLabel = (key: string): string => labels.get(key) ?? key
  // Drawn with Recharts' own Text so a long name wraps within the column with line spacing,
  // centred on its row. The axis's default tick wraps at 1em, so wrapped lines touch.
  const categoryTick = ({ x, y, payload }: CategoryTickProps) => (
    <Text
      x={Number(x)} y={Number(y)} width={categoryAxisWidth - CATEGORY_TICK_PADDING}
      textAnchor="end" verticalAnchor="middle" lineHeight={CATEGORY_LINE_HEIGHT}
      fontSize={AXIS_FONT_SIZE} fill={AXIS_TEXT_COLOR}
    >
      {tickLabel(String(payload?.value ?? ''))}
    </Text>
  )

  // Axes as keyed arrays rather than fragments: Recharts reads its children directly.
  const axes = isBars
    ? [
        <XAxis
          key="value" type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false}
          height={X_AXIS_WITH_HEADING_HEIGHT} label={xAxisHeading(yLabel)}
        />,
        <YAxis
          key="category" type="category" dataKey={KEY} tick={categoryTick}
          tickLine={false} axisLine={{ stroke: GRID_COLOR }} width={categoryAxisWidth} interval={0}
        />,
      ]
    : [
        <XAxis
          key="category" dataKey={KEY} tickFormatter={tickLabel} tick={AXIS_TICK} tickLine={false}
          axisLine={{ stroke: GRID_COLOR }} interval={0}
        />,
        <YAxis
          key="value" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false}
          width={Y_AXIS_WIDTH} label={yAxisHeading(yLabel)}
        />,
      ]

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout={isBars ? 'vertical' : 'horizontal'} margin={CHART_MARGIN} barCategoryGap={categoryGap}>
        <CartesianGrid vertical={isBars} horizontal={!isBars} stroke={GRID_COLOR} />
        {axes}
        <Tooltip
          cursor={{ fill: GRID_COLOR, fillOpacity: CURSOR_OPACITY }}
          content={({ active, label }) => {
            const row = active && label !== undefined ? byKey.get(String(label)) : undefined
            return row === undefined ? null : renderTooltip(row)
          }}
        />
        {series.map((item, index) => (
          <Bar
            key={item.key} dataKey={item.key} name={item.label} stackId={stacked ? 'stack' : undefined}
            stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH} maxBarSize={BAR_MAX_SIZE}
            radius={!stacked || index === lastIndex ? (isBars ? ROUNDED_RIGHT : ROUNDED_TOP) : 0} isAnimationActive={false}
          >
            {rows.map((row) => <Cell key={rowKey(row)} fill={item.color(row)} fillOpacity={item.opacity?.(row) ?? 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
