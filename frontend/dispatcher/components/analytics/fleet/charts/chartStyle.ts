// Mark and axis geometry shared by every fleet chart. Colours come from lib/tokens.ts.

import { AXIS_TEXT_COLOR } from '@/lib/tokens'

/** Plot height including the x-axis band, so a card never scrolls inside itself. */
export const CHART_HEIGHT = 240
/** Shorter height for the four busy-pattern charts, which sit in a row. */
export const PATTERN_CHART_HEIGHT = 160

/** Bars are capped rather than filling their slot. */
export const BAR_MAX_SIZE = 24
/** Rounded at the data end, square at the baseline. */
export const ROUNDED_TOP: [number, number, number, number] = [4, 4, 0, 0]
/** Gap between stacked segments and the ring round dots. */
export const GAP_WIDTH = 2
export const LINE_WIDTH = 2
/** r = 4 gives an 8px dot, the dataviz minimum marker size. */
export const DOT_RADIUS = 4
export const ACTIVE_DOT_RADIUS = 5
/** Partial buckets are faded, never dashed — dashed reads as a forecast. */
export const PARTIAL_OPACITY = 0.5
/** Hover wash behind a hovered column. */
export const CURSOR_OPACITY = 0.4

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const
/** Wide enough for the rotated axis heading and tick numbers up to "100%" side by side. */
export const Y_AXIS_WIDTH = 56
export const AXIS_FONT_SIZE = 11
export const AXIS_TICK = { fill: AXIS_TEXT_COLOR, fontSize: AXIS_FONT_SIZE } as const
/** Invisible hover target for a scatter dot, far bigger than the 8px dot itself. */
export const SCATTER_HIT_RADIUS = 12
/** Recharts drops ticks closer than this rather than rotating or shrinking them. */
export const MIN_TICK_GAP = 8

const HEADING_ANGLE = -90

/** Rotated y-axis heading, centred on the axis. */
export function yAxisHeading(value: string) {
  return {
    value,
    angle: HEADING_ANGLE,
    position: 'insideLeft',
    fill: AXIS_TEXT_COLOR,
    fontSize: AXIS_FONT_SIZE,
    style: { textAnchor: 'middle' },
  } as const
}

/** A downward bar's data end is its bottom. */
export const ROUNDED_BOTTOM: [number, number, number, number] = [0, 0, 4, 4]
/** A horizontal bar's data end is its right-hand edge. */
export const ROUNDED_RIGHT: [number, number, number, number] = [0, 4, 4, 0]
/** Room for long category names beside horizontal bars. */
export const CATEGORY_AXIS_WIDTH = 168
/** Scatter dots are drawn larger than line dots to be found at a glance. */
export const SCATTER_DOT_RADIUS = 6
/** Height of one horizontal bar's row; a long list grows the chart instead of squashing bars. */
export const BAR_ROW_HEIGHT = 32
/** Real line spacing so a wrapped category name's lines don't sit on each other. */
export const CATEGORY_LINE_HEIGHT = '1.3em'
/** Space between a category name and the axis line. */
export const CATEGORY_TICK_PADDING = 8
/** x-axis band height when it carries a heading (horizontal bars and the scatter). */
export const X_AXIS_WITH_HEADING_HEIGHT = 44

/** Value-axis heading for charts whose value axis is the x-axis. */
export function xAxisHeading(value: string) {
  return {
    value,
    position: 'insideBottom',
    fill: AXIS_TEXT_COLOR,
    fontSize: AXIS_FONT_SIZE,
  } as const
}

/** Length of the tick mark drawn under every bucket, labelled or not. */
export const TICK_MARK_SIZE = 5
/** Average glyph width of the 11px axis font, used to estimate a label's width. */
export const AXIS_CHAR_WIDTH_PX = 6.2
/** Least space kept between two neighbouring axis labels. */
export const AXIS_LABEL_GAP_PX = 12
/** Room on the right so the newest label sits centred under its point. */
export const TIME_CHART_MARGIN = { top: 8, right: 32, bottom: 0, left: 0 } as const
/** Pulls line charts' first/last points in from the plot edges so end labels fit. */
export const LINE_EDGE_PADDING_PX = 16
