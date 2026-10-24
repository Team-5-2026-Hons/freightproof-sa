'use client'

import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from 'recharts'

import { useObservedWidth } from '@/lib/hooks/useObservedWidth'
import { AXIS_TEXT_COLOR, GRID_COLOR, SURFACE_COLOR } from '@/lib/tokens'
import { useChartHeight, useIsChartZoomed } from '../ChartZoom'
import { columnLabelLayout } from './axisTicks'
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
  MAX_CATEGORY_AXIS_SHARE,
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
  /** Fades a bar that rests on too little to compare fairly. */
  opacity?: (row: Row) => number
}

interface CategoryBarsProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  categoryLabel: (row: Row) => string
  /** Stacked in order; the last one gets the rounded data end. */
  series: readonly BarSeries<Row>[]
  renderTooltip: (row: Row) => ReactNode
  /** The value-axis heading; on horizontal bars the value axis is the x-axis. */
  yLabel: string
  /** 'columns' stand up from the baseline; 'bars' lie along it, for long category names.
   *  Columns lie down as bars by themselves when the card is too narrow for a name's longest
   *  word to fit under its column (a docked side panel narrows the page). */
  orientation: 'columns' | 'bars'
  /** Stacked adds the series up (parts of one total); side by side compares them. Defaults
   *  to stacked. */
  stacked?: boolean
  height?: number
  /** Horizontal bars only: room for the category names, and each row's height. */
  categoryAxisWidth?: number
  rowHeight?: number
  /** Space between one category's bars and the next, as Recharts' barCategoryGap. */
  categoryGap?: string
  /** How the value axis writes its numbers, e.g. fmtAxisAmount for rand. Plain numbers by default. */
  valueFormatter?: (value: number) => string
}

const KEY = '__key'
// A horizontal bar row's height in the zoom modal: room to read each name at a glance.
const ZOOM_BAR_ROW_HEIGHT = 56

type Datum = Record<string, string | number>

interface CategoryTickProps {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
}

/** Bars over fixed categories rather than time. Categories keep the order the rows come in:
 *  bands stay in lateness order, and a ranked list stays ranked. */
export function CategoryBars<Row>({
  rows, rowKey, categoryLabel, series, renderTooltip, yLabel, orientation, stacked = true, height,
  categoryAxisWidth = CATEGORY_AXIS_WIDTH, rowHeight = BAR_ROW_HEIGHT, categoryGap, valueFormatter,
}: CategoryBarsProps<Row>) {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const labels = new Map(rows.map((row) => [rowKey(row), categoryLabel(row)]))
  const data: Datum[] = rows.map((row) => ({
    [KEY]: rowKey(row),
    ...Object.fromEntries(series.map((item) => [item.key, item.value(row)])),
  }))
  // Columns: each name wraps within its own column, so neighbouring names never run into each
  // other when the card narrows (the chat panel docking beside the page, say). The axis grows
  // by a line for each extra line the longest name needs. When even one word can't fit under
  // its column, the columns lie down as bars with the names beside them, where there is room.
  // Unmeasured, columns are drawn with names on one line.
  const { ref: measureRef, width: measuredWidth } = useObservedWidth<HTMLDivElement>()
  const columnLayout = columnLabelLayout(
    rows.map(categoryLabel), measuredWidth, Y_AXIS_WIDTH + CHART_MARGIN.left + CHART_MARGIN.right,
  )
  const { labelWidth: columnLabelWidth, axisHeight: columnAxisHeight } = columnLayout
  const isBars = orientation === 'bars' || !columnLayout.fits
  // Bars: the names' column narrows with the card, never past its share, so a long lane name
  // wraps rather than squeezing the bars (Cost by lane with the chat panel open).
  const categoryWidth = measuredWidth === null
    ? categoryAxisWidth
    : Math.min(categoryAxisWidth, Math.floor(measuredWidth * MAX_CATEGORY_AXIS_SHARE))
  const lastIndex = series.length - 1
  // Inside the zoom modal, columns take the zoomed height. Horizontal bars size by their
  // rows, so each row gets more room instead: one tall box would leave a short list of bars
  // floating in empty space.
  const isZoomed = useIsChartZoomed()
  const columnsHeight = useChartHeight(CHART_HEIGHT)
  const barRowHeight = isZoomed ? Math.max(rowHeight, ZOOM_BAR_ROW_HEIGHT) : rowHeight
  // The least height: the chart grows to fill its card when a taller card beside it stretches
  // the row, so a short list of bars never leaves the bottom of its card empty.
  const chartHeight = height ?? (isBars ? rows.length * barRowHeight + X_AXIS_WITH_HEADING_HEIGHT : columnsHeight)
  const tickLabel = (key: string): string => labels.get(key) ?? key
  // Drawn with Recharts' own Text so a long name wraps within the column with line spacing;
  // the axis's default tick wraps at 1em, so wrapped lines would touch.
  const categoryTick = ({ x, y, payload }: CategoryTickProps) => (
    <Text
      x={Number(x)} y={Number(y)} width={categoryWidth - CATEGORY_TICK_PADDING}
      textAnchor="end" verticalAnchor="middle" lineHeight={CATEGORY_LINE_HEIGHT}
      fontSize={AXIS_FONT_SIZE} fill={AXIS_TEXT_COLOR}
    >
      {tickLabel(String(payload?.value ?? ''))}
    </Text>
  )
  const columnTick = ({ x, y, payload }: CategoryTickProps) => (
    <Text
      x={Number(x)} y={Number(y)} width={columnLabelWidth ?? undefined}
      textAnchor="middle" verticalAnchor="start" lineHeight={CATEGORY_LINE_HEIGHT}
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
          height={X_AXIS_WITH_HEADING_HEIGHT} label={xAxisHeading(yLabel)} tickFormatter={valueFormatter}
        />,
        <YAxis
          key="category" type="category" dataKey={KEY} tick={categoryTick}
          tickLine={false} axisLine={{ stroke: GRID_COLOR }} width={categoryWidth} interval={0}
        />,
      ]
    : [
        <XAxis
          key="category" dataKey={KEY} tick={columnTick} tickLine={false}
          axisLine={{ stroke: GRID_COLOR }} interval={0} height={columnAxisHeight}
        />,
        <YAxis
          key="value" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false}
          width={Y_AXIS_WIDTH} label={yAxisHeading(yLabel)} tickFormatter={valueFormatter}
        />,
      ]

  return (
    <div ref={measureRef} className="h-full">
      <ResponsiveContainer width="100%" height="100%" minHeight={chartHeight}>
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
    </div>
  )
}
