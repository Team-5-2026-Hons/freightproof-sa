// Time-axis tick labels: every bucket gets a tick mark, but a text label only where it fits
// (every n-th bucket, counting back from the newest). Replaces Recharts' preserveStartEnd,
// which spaced labels unevenly and shifted the end label off its point.

import type { XAxisTickContentProps } from 'recharts'

import { AXIS_TEXT_COLOR } from '@/lib/tokens'
import {
  AXIS_CHAR_WIDTH_PX, AXIS_FONT_SIZE, AXIS_LABEL_GAP_PX, CATEGORY_LINE_PX, COLUMN_AXIS_HEIGHT, COLUMN_LABEL_GAP_PX,
} from './chartStyle'

// Recharts' own offset for tick text: one line below the tick mark.
const LABEL_DY = '0.71em'

/** Smallest step n so labelling every n-th of `bucketCount` buckets across `plotWidth` px keeps
 *  neighbouring labels at least AXIS_LABEL_GAP_PX apart. */
export function labelStep(bucketCount: number, plotWidth: number, labelWidth: number): number {
  if (bucketCount <= 1 || !Number.isFinite(plotWidth) || plotWidth <= 0) return 1
  const spacing = plotWidth / bucketCount
  return Math.max(1, Math.ceil((labelWidth + AXIS_LABEL_GAP_PX) / spacing))
}

/** Whether bucket `index` (oldest = 0) carries a label: every step-th, counting back from the newest. */
export function isLabelled(index: number, bucketCount: number, step: number): boolean {
  return (bucketCount - 1 - index) % step === 0
}

// A canvas measures text exactly as the chart draws it. Created on first use; null where there
// is no real canvas (server rendering, and jsdom in tests), which falls back to an estimate.
let measureContext: CanvasRenderingContext2D | null | undefined

function canMeasure(): boolean {
  return typeof document !== 'undefined' && !navigator.userAgent.includes('jsdom')
}

/** The px width of `text` in the axis font: measured in a browser, estimated from the average
 *  glyph width elsewhere. The estimate runs about a fifth wide, so it only ever errs towards
 *  more room. */
export function axisTextWidth(text: string): number {
  if (measureContext === undefined) {
    measureContext = canMeasure() ? document.createElement('canvas').getContext('2d') : null
    if (measureContext !== null) {
      measureContext.font = `${AXIS_FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`
    }
  }
  return measureContext === null ? text.length * AXIS_CHAR_WIDTH_PX : measureContext.measureText(text).width
}

/** How many lines `label` takes when wrapped at word breaks within `maxWidth` px. A single word
 *  wider than that still takes one line. */
export function wrappedLineCount(label: string, maxWidth: number): number {
  const spaceWidth = axisTextWidth(' ')
  let lines = 1
  let used = 0
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const wordWidth = axisTextWidth(word)
    const needed = used === 0 ? wordWidth : used + spaceWidth + wordWidth
    if (used > 0 && needed > maxWidth) {
      lines += 1
      used = wordWidth
    } else {
      used = needed
    }
  }
  return lines
}

export interface ColumnLabelLayout {
  /** Each name's wrap width: its column's share of the plot, less a gap. Null = don't wrap. */
  labelWidth: number | null
  /** The x-axis band: one line, plus a line for each extra line the longest name needs. */
  axisHeight: number
  /** False when some single word is wider than its column: wrapping can't help, so the chart
   *  should lie its bars sideways with the names beside them instead. */
  fits: boolean
}

function longestWordWidth(label: string): number {
  return label.split(/\s+/).reduce((widest, word) => Math.max(widest, axisTextWidth(word)), 0)
}

/** How column names under a category chart fit `chartWidth` px (null until measured), when
 *  `reservedWidth` px of it go to the y-axis and margins. */
export function columnLabelLayout(labels: readonly string[], chartWidth: number | null, reservedWidth: number): ColumnLabelLayout {
  const labelWidth = chartWidth === null || labels.length === 0
    ? null
    : (chartWidth - reservedWidth) / labels.length - COLUMN_LABEL_GAP_PX
  // Unmeasured: draw as columns on one line until the first measurement says otherwise.
  if (labelWidth === null) return { labelWidth: null, axisHeight: COLUMN_AXIS_HEIGHT, fits: true }
  const fits = labelWidth > 0 && labels.every((label) => longestWordWidth(label) <= labelWidth)
  if (!fits) return { labelWidth: null, axisHeight: COLUMN_AXIS_HEIGHT, fits: false }
  const lines = Math.max(1, ...labels.map((label) => wrappedLineCount(label, labelWidth)))
  return { labelWidth, axisHeight: COLUMN_AXIS_HEIGHT + Math.ceil((lines - 1) * CATEGORY_LINE_PX), fits: true }
}

/** Rough px width of the widest label, at the axis font's average glyph width. */
export function labelWidthFor(labels: readonly string[]): number {
  return labels.reduce((widest, label) => Math.max(widest, label.length), 0) * AXIS_CHAR_WIDTH_PX
}

/** A time-axis tick: the label centred under its bucket, or nothing for an unlabelled bucket. */
export function renderTimeTick(
  props: XAxisTickContentProps,
  tickLabel: (key: string) => string,
  bucketCount: number,
  labelWidth: number,
) {
  const { x, y, index, width, payload } = props
  const step = labelStep(bucketCount, Number(width), labelWidth)
  if (!isLabelled(index, bucketCount, step)) return <g />
  return (
    <text x={x} y={y} dy={LABEL_DY} textAnchor="middle" fill={AXIS_TEXT_COLOR} fontSize={AXIS_FONT_SIZE}>
      {tickLabel(String(payload.value))}
    </text>
  )
}
