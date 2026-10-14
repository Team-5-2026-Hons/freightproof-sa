import { describe, expect, it } from 'vitest'
import { SPLIT_MIN_PX } from '@/lib/phase/layout'
import { VIEWPORT_PRESETS, cardContentPx, frameWidthPx, presetDocksPanel } from './frame'

// The card widths measured in the real trip page (lib/phase/layout.ts): the frame must hand the
// real TripTimeline exactly this much room, or the preview shows a layout nobody gets.
const MEASURED_CARD_PX: Record<number, number> = { 1440: 772, 1280: 676, 1024: 772, 768: 564 }

describe('timeline scenario frame', () => {
  it.each(VIEWPORT_PRESETS.map(preset => [preset.width, preset] as const))('gives the card %i px of viewport the measured content width', (width, preset) => {
    expect(cardContentPx(preset)).toBe(MEASURED_CARD_PX[width])
  })

  it('docks the exceptions panel from 1280 px up, as the real page does', () => {
    expect(VIEWPORT_PRESETS.map(preset => [preset.width, presetDocksPanel(preset)])).toEqual([[1440, true], [1280, true], [1024, false], [768, false]])
  })

  it('sizes the frame so the timeline inside it is as wide as the real page gives it', () => {
    // 1440: 1440 - 80 rail - 400 panel = 960, past the 896 px cap, so the cap decides; plus the frame's border.
    const desktop = VIEWPORT_PRESETS.find(preset => preset.width === 1440)!
    const laptop = VIEWPORT_PRESETS.find(preset => preset.width === 1280)!

    expect(frameWidthPx(desktop)).toBe(960 + 2)
    expect(frameWidthPx(laptop)).toBe(800 + 2)
  })

  it('splits only at the one measured width that holds two columns (772), and stacks at 676 and 564', () => {
    const splits = VIEWPORT_PRESETS.map(preset => [preset.width, cardContentPx(preset) >= SPLIT_MIN_PX])

    expect(splits).toEqual([[1440, true], [1280, false], [1024, true], [768, false]])
  })
})
