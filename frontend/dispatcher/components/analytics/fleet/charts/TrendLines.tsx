'use client'

import type { ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type XAxisTickContentProps,
} from 'recharts'

import { AXIS_TEXT_COLOR, GRID_COLOR, SURFACE_COLOR, TICK_COLOR } from '@/lib/tokens'
import { useChartHeight } from '../ChartZoom'
import { labelWidthFor, renderTimeTick } from './axisTicks'
import {
  ACTIVE_DOT_RADIUS,
  AXIS_TICK,
  CHART_HEIGHT,
  DOT_RADIUS,
  GAP_WIDTH,
  LINE_EDGE_PADDING_PX,
  LINE_WIDTH,
  PARTIAL_OPACITY,
  TICK_MARK_SIZE,
  TIME_CHART_MARGIN,
  Y_AXIS_WIDTH,
  yAxisHeading,
} from './chartStyle'

export interface LineSeries<Row> {
  key: string
  label: string
  color: string
  /** null leaves a gap: no observations is not zero. */
  value: (row: Row) => number | null
}

interface TrendLinesProps<Row> {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  tickLabel: (key: string) => string
  isPartial: (row: Row) => boolean
  series: readonly LineSeries<Row>[]
  renderTooltip: (row: Row) => ReactNode
  /** The y-axis heading, e.g. "Cancelled trips". Required: every chart names its value axis (spec §7.7). */
  yLabel: string
  height?: number
  yTickFormat?: (value: number) => string
  /** Fixed range, e.g. [0, 100] for a percentage, so the scale never exaggerates a wobble. */
  yDomain?: [number, number]
  allowDecimals?: boolean
}

const KEY = '__key'
const PARTIAL = '__partial'

type Datum = Record<string, string | number | boolean | null>

/** Lines over time (charts 1.7, 2.1, 3.2, 4.2, 4.3, 5.2, 5.7). Spec §7.4: 2 px lines, 8 px
 *  dots with a 2 px surface ring, partial buckets' dots at half opacity (never a dashed
 *  line, which reads as a forecast), a crosshair that finds the x, gaps where there is no data. */
export function TrendLines<Row>({
  rows, rowKey, tickLabel, isPartial, series, renderTooltip, yLabel, height: normalHeight = CHART_HEIGHT,
  yTickFormat, yDomain, allowDecimals = false,
}: TrendLinesProps<Row>) {
  // Taller inside the zoom modal (D27).
  const height = useChartHeight(normalHeight)
  const byKey = new Map(rows.map((row) => [rowKey(row), row]))
  const labelWidth = labelWidthFor(rows.map((row) => tickLabel(rowKey(row))))
  const data: Datum[] = rows.map((row) => ({
    [KEY]: rowKey(row),
    [PARTIAL]: isPartial(row),
    ...Object.fromEntries(series.map((item) => [item.key, item.value(row)])),
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={TIME_CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey={KEY} interval={0} tickLine={{ stroke: TICK_COLOR }} tickSize={TICK_MARK_SIZE}
          axisLine={{ stroke: GRID_COLOR }}
          padding={{ left: LINE_EDGE_PADDING_PX, right: LINE_EDGE_PADDING_PX }}
          tick={(props: XAxisTickContentProps) => renderTimeTick(props, tickLabel, rows.length, labelWidth)}
        />
        <YAxis
          allowDecimals={allowDecimals} domain={yDomain} tickFormatter={yTickFormat} tick={AXIS_TICK}
          tickLine={false} axisLine={false} width={Y_AXIS_WIDTH} label={yAxisHeading(yLabel)}
        />
        <Tooltip
          cursor={{ stroke: AXIS_TEXT_COLOR, strokeWidth: 1 }}
          content={({ active, label }) => {
            const row = active && label !== undefined ? byKey.get(String(label)) : undefined
            return row === undefined ? null : renderTooltip(row)
          }}
        />
        {series.map((item) => (
          <Line
            key={item.key} dataKey={item.key} name={item.label} type="linear" stroke={item.color}
            strokeWidth={LINE_WIDTH} strokeLinecap="round" strokeLinejoin="round" connectNulls={false}
            isAnimationActive={false}
            dot={(props: DotItemDotProps) => {
              if (props.cx == null || props.cy == null) return null
              const partial = data[props.index]?.[PARTIAL] === true
              return (
                <circle
                  key={`${item.key}-${props.index}`} cx={props.cx} cy={props.cy} r={DOT_RADIUS}
                  fill={item.color} stroke={SURFACE_COLOR} strokeWidth={GAP_WIDTH}
                  opacity={partial ? PARTIAL_OPACITY : 1}
                />
              )
            }}
            activeDot={{ r: ACTIVE_DOT_RADIUS, fill: item.color, stroke: SURFACE_COLOR, strokeWidth: GAP_WIDTH }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
