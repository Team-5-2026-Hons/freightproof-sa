import { describe, expect, it } from 'vitest'

import { AXIS_CHAR_WIDTH_PX, AXIS_LABEL_GAP_PX } from './chartStyle'
import { isLabelled, labelStep, labelWidthFor } from './axisTicks'

describe('time-axis labels (spec §7.7 item 4)', () => {
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
