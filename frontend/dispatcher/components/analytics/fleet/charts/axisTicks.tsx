// Time-axis tick labels: every bucket gets a tick mark, but a text label only where it fits
// (every n-th bucket, counting back from the newest). Replaces Recharts' preserveStartEnd,
// which spaced labels unevenly and shifted the end label off its point.

import type { XAxisTickContentProps } from 'recharts'

import { AXIS_TEXT_COLOR } from '@/lib/tokens'
import { AXIS_CHAR_WIDTH_PX, AXIS_FONT_SIZE, AXIS_LABEL_GAP_PX } from './chartStyle'

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
