import { describe, expect, it } from 'vitest'
import {
  clampPanelWidth, nextPanelWidth, DETAIL_PANEL_MIN_W, DETAIL_PANEL_MAX_W,
} from './useResizablePanel'

const MIN = DETAIL_PANEL_MIN_W
const MAX = DETAIL_PANEL_MAX_W

describe('nextPanelWidth', () => {
  describe('right-edge handle (fleet vehicle/driver panels)', () => {
    it('widens as the pointer moves right', () => {
      expect(nextPanelWidth(500, +80, 'right', MIN, MAX)).toBe(580)
    })

    it('narrows as the pointer moves left', () => {
      expect(nextPanelWidth(500, -80, 'right', MIN, MAX)).toBe(420)
    })
  })

  describe('left-edge handle (trip manifest panel)', () => {
    // The defect: the manifest panel's handle is on its LEFT edge, so it grows backwards
    // into the timeline column. Sharing the right-edge sign made it track the cursor in
    // the opposite direction.
    it('widens as the pointer moves LEFT', () => {
      expect(nextPanelWidth(500, -80, 'left', MIN, MAX)).toBe(580)
    })

    it('narrows as the pointer moves right', () => {
      expect(nextPanelWidth(500, +80, 'left', MIN, MAX)).toBe(420)
    })

    it('is the exact mirror of a right-edge handle for the same pointer movement', () => {
      const delta = 137

      expect(nextPanelWidth(500, delta, 'left', MIN, MAX))
        .toBe(nextPanelWidth(500, -delta, 'right', MIN, MAX))
    })
  })

  describe('clamping', () => {
    it('never exceeds max however far the pointer travels', () => {
      expect(nextPanelWidth(500, -5000, 'left', MIN, MAX)).toBe(MAX)
    })

    it('never drops below min', () => {
      expect(nextPanelWidth(500, +5000, 'left', MIN, MAX)).toBe(MIN)
    })

    it('honours a max tightened by the available space, not the constant ceiling', () => {
      // What stops the panel pushing Trip Info out of an overflow-hidden row: the caller
      // passes the space actually left over, and that beats DETAIL_PANEL_MAX_W.
      const availableMax = 480

      expect(nextPanelWidth(460, -200, 'left', MIN, availableMax)).toBe(availableMax)
    })

    it('gives up its minimum when available space has collapsed below it', () => {
      // A narrow viewport can leave less room than the panel's own minimum. Available
      // space wins: a cramped panel is cosmetic, but one wider than the row pushes the
      // next column out of an overflow-hidden container and clips it off screen.
      expect(nextPanelWidth(500, -100, 'left', MIN, 120)).toBe(120)
    })

    it('never returns a negative width when no space is left at all', () => {
      expect(nextPanelWidth(500, -100, 'left', MIN, -80)).toBe(0)
    })
  })
})

describe('clampPanelWidth — the three-column budget', () => {
  // The trip-detail row is timeline | manifest | Trip Info, inside overflow-hidden. If
  // the three ever sum to more than the row, Trip Info is the one that gets clipped.
  const TIMELINE_MIN = 420
  const SIDEBAR = 304

  function manifestMax(rowWidth: number, sidebarWidth: number): number {
    return Math.min(MAX, Math.max(0, rowWidth - TIMELINE_MIN - sidebarWidth))
  }

  it('keeps the three columns inside a 1280px viewport (1060px row behind the 220px nav)', () => {
    const row = 1060
    const width = clampPanelWidth(MAX, MIN, manifestMax(row, SIDEBAR))

    expect(TIMELINE_MIN + width + SIDEBAR).toBeLessThanOrEqual(row)
  })

  it('reserves the sidebar BORDER box — measuring its content box over-granted by its padding', () => {
    // The regression: `w-304 p-5` measures 264 as a content box. Budgeting against 264
    // handed the manifest 40px that Trip Info needed, and the row clipped it.
    const row = 1060
    const fromContentBox = clampPanelWidth(MAX, MIN, manifestMax(row, SIDEBAR - 40))

    expect(TIMELINE_MIN + fromContentBox + SIDEBAR).toBeGreaterThan(row)
  })

  it('grants the full ceiling once the row is genuinely wide enough', () => {
    const row = 2000

    expect(clampPanelWidth(MAX, MIN, manifestMax(row, SIDEBAR))).toBe(MAX)
  })

  it('gives the sidebar space back to the manifest when the sidebar is hidden', () => {
    const row = 1060

    expect(manifestMax(row, 0)).toBeGreaterThan(manifestMax(row, SIDEBAR))
  })
})
