// The width arithmetic behind the scenario frames: how wide a box must be so the REAL TripTimeline
// inside it is given the same room the real trip page gives it at each viewport. Kept pure so a
// test can pin it against the card widths measured in the browser (lib/phase/layout.ts).

export interface ViewportPreset {
  id: string
  /** The browser width the preset stands in for. */
  width: number
  label: string
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'd1440', width: 1440, label: 'Desktop 1440' },
  { id: 'l1280', width: 1280, label: 'Laptop 1280' },
  { id: 't1024', width: 1024, label: 'Tablet 1024' },
  { id: 't768', width: 768, label: 'Tablet 768' },
]

// The app's collapsed navigation rail, which every real page sits beside.
const SIDEBAR_RAIL_PX = 80
// DetailPanel's own breakpoint and column width (components/ui/DetailPanel.tsx keeps both private).
const DOCK_MIN_VIEWPORT_PX = 1280
const DOCKED_PANEL_PX = 400
// TripTimeline's section: `max-w-4xl` with `md:p-6` on each side.
const TIMELINE_MAX_PX = 896
const TIMELINE_PADDING_PX = 24
// Around a phase card's content: node column (30) + gap (14) + card padding (2 x 16).
const CARD_CHROME_PX = 76
// The frame draws a 1 px border on each side, inside its own width.
const FRAME_BORDER_PX = 2

/** At 1280 and wider the panel is a permanent column and takes its width from the timeline. */
export function presetDocksPanel(preset: ViewportPreset): boolean {
  return preset.width >= DOCK_MIN_VIEWPORT_PX
}

function columnPx(preset: ViewportPreset): number {
  return preset.width - SIDEBAR_RAIL_PX - (presetDocksPanel(preset) ? DOCKED_PANEL_PX : 0)
}

/** The CSS width of the frame around the timeline: the room left of the panel, border included. */
export function frameWidthPx(preset: ViewportPreset): number {
  return columnPx(preset) + FRAME_BORDER_PX
}

/** The content width the phase card ends up with inside that frame (what `useObservedWidth`
 *  measures): 772 at 1440 and 1024, 676 at 1280, 564 at 768. */
export function cardContentPx(preset: ViewportPreset): number {
  return Math.min(columnPx(preset), TIMELINE_MAX_PX) - 2 * TIMELINE_PADDING_PX - CARD_CHROME_PX
}
