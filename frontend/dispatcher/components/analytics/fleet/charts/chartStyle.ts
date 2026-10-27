// Mark and axis geometry shared by every fleet chart. Colours come from lib/tokens.ts.

import { AXIS_TEXT_COLOR } from '@/lib/tokens'

export const CHART_HEIGHT = 240
export const PATTERN_CHART_HEIGHT = 160

export const BAR_MAX_SIZE = 24
export const ROUNDED_TOP: [number, number, number, number] = [4, 4, 0, 0]
export const GAP_WIDTH = 2
export const LINE_WIDTH = 2
export const DOT_RADIUS = 4
export const ACTIVE_DOT_RADIUS = 5
export const PARTIAL_OPACITY = 0.5
export const CURSOR_OPACITY = 0.4

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const
export const Y_AXIS_WIDTH = 56
export const AXIS_FONT_SIZE = 11
export const AXIS_TICK = { fill: AXIS_TEXT_COLOR, fontSize: AXIS_FONT_SIZE } as const
export const SCATTER_HIT_RADIUS = 12
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

export const ROUNDED_BOTTOM: [number, number, number, number] = [0, 0, 4, 4]
export const ROUNDED_RIGHT: [number, number, number, number] = [0, 4, 4, 0]
export const CATEGORY_AXIS_WIDTH = 168
export const MAX_CATEGORY_AXIS_SHARE = 0.45
export const SCATTER_DOT_RADIUS = 6
export const BAR_ROW_HEIGHT = 32
const CATEGORY_LINE_RATIO = 1.3
export const CATEGORY_LINE_HEIGHT = `${CATEGORY_LINE_RATIO}em`
export const CATEGORY_LINE_PX = AXIS_FONT_SIZE * CATEGORY_LINE_RATIO
export const COLUMN_AXIS_HEIGHT = 30
export const COLUMN_LABEL_GAP_PX = 6
export const CATEGORY_TICK_PADDING = 8
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

export const TICK_MARK_SIZE = 5
export const AXIS_CHAR_WIDTH_PX = 6.2
export const AXIS_LABEL_GAP_PX = 12
export const TIME_CHART_MARGIN = { top: 8, right: 32, bottom: 0, left: 0 } as const
export const LINE_EDGE_PADDING_PX = 16
