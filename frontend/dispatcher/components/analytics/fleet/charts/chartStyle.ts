// Mark and axis specs shared by every fleet chart (fleet analytics spec §7.4 and §7.7, from the
// dataviz skill's marks-and-anatomy rules). Colours come from lib/tokens.ts; this file holds
// only geometry, so every chart draws a bar, a line or an axis the same way.

import { AXIS_TEXT_COLOR } from '@/lib/tokens'

/** Plot height including the x-axis band, so a card never scrolls inside itself. */
export const CHART_HEIGHT = 240
/** Each of the four busy-pattern charts is shorter: they sit in a row. */
export const PATTERN_CHART_HEIGHT = 160

/** Bars are capped rather than filling their slot, so the leftover band reads as air. */
export const BAR_MAX_SIZE = 24
/** Rounded at the data end, square at the baseline. Only the top segment of a stack. */
export const ROUNDED_TOP: [number, number, number, number] = [4, 4, 0, 0]
/** Drawn in the surface colour: the gap between stacked segments and the ring round dots. */
export const GAP_WIDTH = 2
export const LINE_WIDTH = 2
/** r = 4 gives an 8 px dot, the dataviz minimum for a marker. */
export const DOT_RADIUS = 4
export const ACTIVE_DOT_RADIUS = 5
/** Partial buckets are faded, never dashed: a dashed line reads as a forecast. */
export const PARTIAL_OPACITY = 0.5
/** The hover wash behind a hovered column. */
export const CURSOR_OPACITY = 0.4

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const
/** Wide enough for the rotated axis heading AND tick numbers up to "100%" side by side, so
 *  the two never overlap (spec §7.7). */
export const Y_AXIS_WIDTH = 56
export const AXIS_FONT_SIZE = 11
export const AXIS_TICK = { fill: AXIS_TEXT_COLOR, fontSize: AXIS_FONT_SIZE } as const
/** A scatter dot's invisible hover target: 24 px across, far bigger than the 8 px dot (dataviz
 *  interaction rules), so a pointer need only be near a dot, not dead on it. */
export const SCATTER_HIT_RADIUS = 12
/** Keeps crowded week labels from colliding: Recharts drops ticks closer than this rather than
 *  rotating or shrinking them. The tooltip carries the full range (spec §7.7). */
export const MIN_TICK_GAP = 8

const HEADING_ANGLE = -90

/** The y-axis heading every chart carries (spec §7.7): rotated along the value axis's outer
 *  edge, in the axis text style, centred on the axis. */
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

/** A downward bar's data end is its bottom (chart 2.5's under-plan bars). */
export const ROUNDED_BOTTOM: [number, number, number, number] = [0, 0, 4, 4]
/** A horizontal bar's data end is its right-hand edge. */
export const ROUNDED_RIGHT: [number, number, number, number] = [0, 4, 4, 0]
/** Room for category names such as "Waybill Count Mismatch" beside horizontal bars. */
export const CATEGORY_AXIS_WIDTH = 168
/** A scatter dot stands alone rather than on a line, so it is drawn a little larger than a
 *  line's dots to be found at a glance (chart 6.3, Tom). */
export const SCATTER_DOT_RADIUS = 6
/** One horizontal bar's row: a long list grows the chart instead of squashing the bars. */
export const BAR_ROW_HEIGHT = 32
/** A category name that wraps gets real line spacing, so its lines don't sit on each other. */
export const CATEGORY_LINE_HEIGHT = '1.3em'
/** Space between a category name and the axis line. */
export const CATEGORY_TICK_PADDING = 8
/** The x-axis band when it carries a heading (horizontal bars and the scatter). */
export const X_AXIS_WITH_HEADING_HEIGHT = 44

/** The value-axis heading for charts whose value axis is the x-axis (spec §7.7: "horizontal
 *  bar charts put the heading on their value axis instead"), under the tick numbers. */
export function xAxisHeading(value: string) {
  return {
    value,
    position: 'insideBottom',
    fill: AXIS_TEXT_COLOR,
    fontSize: AXIS_FONT_SIZE,
  } as const
}

// ── Time axes (spec §7.7 item 4, D23) ─────────────────────────────────────────

/** Length of the tick mark drawn under every bucket, labelled or not. */
export const TICK_MARK_SIZE = 5
/** Average glyph width of the 11 px axis font: a label's width is its length times this. */
export const AXIS_CHAR_WIDTH_PX = 6.2
/** The least space kept between two neighbouring axis labels. */
export const AXIS_LABEL_GAP_PX = 12
/** Room on the right so the newest label sits centred under its point, never pushed inward.
 *  Half the widest week label ("29 Dec–4 Jan") and a little over. */
export const TIME_CHART_MARGIN = { top: 8, right: 32, bottom: 0, left: 0 } as const
/** Line charts put their first and last points on the plot's edges; this pulls them in far
 *  enough that the end labels fit. */
export const LINE_EDGE_PADDING_PX = 16
