// Raw colour values for the dispatcher's charts: the one file eslint.config.mjs lets hold hex
// literals, for Recharts props and SVG attributes that cannot take a Tailwind class.
//
// The fleet Analytics palette (fleet analytics spec §7.3) was validated on 2026-09-15 with the
// dataviz skill's validate_palette.js, in light mode, against the chart surface #ffffff (the
// dispatcher has no dark mode). Every chart takes its colours from here, never an ad-hoc hex,
// so any change is re-validated in one place.
//
// Two rules the numbers depend on:
//   - Categorical series take slots in fixed order and never cycle. A 6th series is not a new
//     colour; it folds into "Other" or a second chart.
//   - The app's own warning (#805600) and critical (#ba1a1a) tokens are never stacked side by
//     side: for colour-blind readers they are ΔE 2.8 apart (target ≥ 8), a hard fail (spec D18).

/** Categorical slots 1-5. Slots 1-3 pass adjacent and all-pairs checks (worst colour-blind
 *  ΔE 9.2, normal 24.0). Slots 4 and 5 are only for the five-slice "where the time goes"
 *  stack (adjacent worst 9.1). Slots 3-5 are under 3:1 contrast, so their charts always carry a
 *  legend and a table view. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const

/** De-emphasised bars (Early / On time, unwitnessed, the non-busiest pattern bars). 3.59:1. */
export const NEUTRAL_COLOR = '#898781'

/** Status colours, reserved for state and never used as "series 4". Each ships with an icon
 *  and a label, never colour alone: warning is only 1.7:1 against white. */
export const STATUS_COLORS = {
  // The app's warn-c token. Against critical: colour-blind ΔE 32.4, normal 35.4.
  warning: '#ffb95f',
  // The app's err token. Text contrast 6.46:1.
  critical: '#ba1a1a',
  // The app's ok token. ΔE 12.6 from the neutral grey; never placed next to critical.
  good: '#006c4c',
} as const

/** Lateness bands 1-15 min, 15-60 min, 1-3 h, 3 h+: one hue, light to dark (validated with
 *  --ordinal: monotone, ΔL ≥ 0.06, light end 2.11:1). */
export const LATENESS_RAMP = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] as const

/** Chart 2.4: typical (median) and bad-day (P90) driving time, two steps of the ramp above. */
export const LANE_TYPICAL_COLOR = LATENESS_RAMP[1]
export const LANE_BAD_DAY_COLOR = LATENESS_RAMP[3]

/** Recessive chart furniture: the app's surf-high and on-surf-v tokens. */
export const GRID_COLOR = '#e5e2e3'
export const AXIS_TEXT_COLOR = '#46464f'
/** Tick marks under every bucket (the app's outline-v): darker than the grid so each one shows. */
export const TICK_COLOR = '#c7c6ca'
/** The 2 px gap between stacked segments, and the ring round line dots, are drawn in this. */
export const SURFACE_COLOR = '#ffffff'
