import { describe, expect, it } from 'vitest'

import { AXIS_CHAR_WIDTH_PX, AXIS_LABEL_GAP_PX, CATEGORY_LINE_PX, COLUMN_AXIS_HEIGHT } from './chartStyle'
import { columnLabelLayout, isLabelled, labelStep, labelWidthFor, wrappedLineCount } from './axisTicks'

describe('time-axis labels', () => {
  it('labels every bucket when they all fit', () => {
    expect(labelStep(4, 600, 60)).toBe(1)
  })

  it('steps just far enough that labels never come closer than the minimum gap', () => {
    for (const [count, width, labelWidth] of [[12, 600, 60], [53, 900, 76], [24, 500, 50], [7, 200, 76]] as const) {
      const step = labelStep(count, width, labelWidth)

      expect((width / count) * step).toBeGreaterThanOrEqual(labelWidth + AXIS_LABEL_GAP_PX)
      if (step > 1) expect((width / count) * (step - 1)).toBeLessThan(labelWidth + AXIS_LABEL_GAP_PX)
    }
  })

  it('always labels the newest bucket, then every step-th counting back', () => {
    const labelled = Array.from({ length: 12 }, (_, index) => isLabelled(index, 12, 3))

    expect(labelled[11]).toBe(true)
    expect(labelled.map((on, index) => (on ? index : null)).filter((index) => index !== null)).toEqual([2, 5, 8, 11])
  })

  it('labels a single bucket, and everything while the width is unknown', () => {
    expect(labelStep(1, 300, 60)).toBe(1)
    expect(labelStep(10, 0, 60)).toBe(1)
    expect(labelStep(10, Number.NaN, 60)).toBe(1)
  })

  it('sizes labels by the widest one', () => {
    expect(labelWidthFor(['7–13 Sep', '29 Jun–5 Jul'])).toBeCloseTo('29 Jun–5 Jul'.length * AXIS_CHAR_WIDTH_PX)
  })
})

describe('column names under category charts', () => {
  const STEPS = ['Activation', 'Loading', 'Waiting to leave', 'Driving', 'Arrival seal check', 'Unloading', 'Sign-off', 'Not linked to a step']

  it('wraps a name at word breaks to fit its width', () => {
    expect(wrappedLineCount('Arrival seal check', 200)).toBe(1)
    expect(wrappedLineCount('Arrival seal check', 13 * AXIS_CHAR_WIDTH_PX)).toBe(2)
    expect(wrappedLineCount('Not linked to a step', 6 * AXIS_CHAR_WIDTH_PX)).toBe(4)
  })

  it('keeps a word longer than the width on one line rather than splitting it', () => {
    expect(wrappedLineCount('Activation', 3 * AXIS_CHAR_WIDTH_PX)).toBe(1)
    expect(wrappedLineCount('', 50)).toBe(1)
  })

  it('gives each name its column, less a gap, and grows the axis by a line per extra line', () => {
    const wide = columnLabelLayout(STEPS, 1600, 64)
    const narrow = columnLabelLayout(STEPS, 720, 64)

    expect(wide.axisHeight).toBe(COLUMN_AXIS_HEIGHT)
    expect(narrow.fits).toBe(true)
    expect(narrow.labelWidth).toBeCloseTo((720 - 64) / STEPS.length - 6)
    const lines = Math.max(...STEPS.map((step) => wrappedLineCount(step, narrow.labelWidth ?? 0)))
    expect(lines).toBeGreaterThan(1)
    expect(narrow.axisHeight).toBe(COLUMN_AXIS_HEIGHT + Math.ceil((lines - 1) * CATEGORY_LINE_PX))
  })

  it('draws columns with names on one line until the chart has been measured', () => {
    expect(columnLabelLayout(STEPS, null, 64)).toEqual({ labelWidth: null, axisHeight: COLUMN_AXIS_HEIGHT, fits: true })
    expect(columnLabelLayout([], 600, 64)).toEqual({ labelWidth: null, axisHeight: COLUMN_AXIS_HEIGHT, fits: true })
  })

  it('says the names do not fit once a single word is wider than its column, so the bars lie down', () => {
    const narrow = columnLabelLayout(STEPS, 395, 64)

    expect(narrow.fits).toBe(false)
    expect(columnLabelLayout(STEPS, 40, 64).fits).toBe(false)
    expect(columnLabelLayout(STEPS, 1600, 64).fits).toBe(true)
  })
})
