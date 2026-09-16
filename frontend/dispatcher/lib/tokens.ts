// Raw hex chart colours (the one file eslint.config.mjs allows hex literals in, for Recharts/SVG
// props). Colour-blind-safe; validated with the dataviz skill's validate_palette.js.

/** Categorical slots 1-5, fixed order (no cycling). Slots 3-5 are under 3:1 contrast, so pair with a legend/table. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const

/** De-emphasised bars (early/on-time, unwitnessed). */
export const NEUTRAL_COLOR = '#898781'

/** Status colours; always paired with an icon and label, never colour alone. */
export const STATUS_COLORS = {
  warning: '#ffb95f',
  critical: '#ba1a1a',
  good: '#006c4c',
} as const

/** Lateness bands (1-15min, 15-60min, 1-3h, 3h+): one hue, light to dark. */
export const LATENESS_RAMP = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] as const

/** Typical (median) and bad-day (P90) driving time, two steps of the ramp above. */
export const LANE_TYPICAL_COLOR = LATENESS_RAMP[1]
export const LANE_BAD_DAY_COLOR = LATENESS_RAMP[3]

/** Recessive chart furniture. */
export const GRID_COLOR = '#e5e2e3'
export const AXIS_TEXT_COLOR = '#46464f'
export const TICK_COLOR = '#c7c6ca'
export const SURFACE_COLOR = '#ffffff'
