// Getting back to the Analytics page from a detail page it links to: Back must land on the
// same tab with the same View by and Period, not the page's defaults. The return address
// carries those choices so a refresh of the returned-to page keeps them too.

import { ROUTES } from '@/lib/constants/routes'
import { GENERAL_PRESETS, GRAINS, PRESETS_BY_GRAIN, type PresetId } from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'
import type { TabControls } from './controls/ControlRow'

export const TAB_PARAM = 'tab'
/** Which window the incident map is showing. Declared here rather than beside the tab so the
 *  address parser doesn't have to import a React component to name its own return type. */
export type MapWindow = 'today' | 'period'
export const MAP_PARAM = 'map'
const MAP_TODAY = 'today'
const GRAIN_PARAM = 'grain'
const PERIOD_PARAM = 'period'
const START_PARAM = 'start'
const END_PARAM = 'end'
const CUSTOM = 'custom'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const ALL_PRESETS: ReadonlySet<string> = new Set<PresetId>([
  ...GENERAL_PRESETS,
  ...Object.values(PRESETS_BY_GRAIN).flat(),
])

/** The Analytics address for `tab` with these choices, e.g.
 *  "/analytics?tab=routes&grain=week&period=last_26_weeks".
 *
 *  `mapWindow` is written only when it is Today: "period" is the default the page already
 *  reaches without it, so leaving it out keeps the common address short and bookmarkable. */
export function analyticsReturnHref(tab: string, controls: TabControls, mapWindow?: MapWindow): string {
  const params = new URLSearchParams({
    [TAB_PARAM]: tab,
    [GRAIN_PARAM]: controls.grain,
    [PERIOD_PARAM]: controls.period.preset,
  })
  if (controls.period.preset === CUSTOM) {
    params.set(START_PARAM, controls.period.start)
    params.set(END_PARAM, controls.period.end)
  }
  if (mapWindow === MAP_TODAY) params.set(MAP_PARAM, MAP_TODAY)
  return `${ROUTES.analytics}?${params.toString()}`
}

/** The incident map's window from the address. Anything the page didn't write (missing,
 *  hand-edited, or from an older version) reads as the default rather than failing. */
export function mapWindowFromSearch(search: URLSearchParams): MapWindow {
  return search.get(MAP_PARAM) === MAP_TODAY ? MAP_TODAY : 'period'
}

/** True when the address carries choices from analyticsReturnHref. */
export function hasReturnedControls(search: URLSearchParams): boolean {
  return search.has(PERIOD_PARAM)
}

function isGrain(value: string | null): value is Grain {
  return value !== null && (GRAINS as readonly string[]).includes(value)
}

function isPresetId(value: string): value is PresetId {
  return ALL_PRESETS.has(value)
}

/** The choices an analyticsReturnHref carried back, or null when the address has none or they
 *  don't make sense (hand-edited, or from an older version of the page). */
export function controlsFromSearch(search: URLSearchParams): TabControls | null {
  const grain = search.get(GRAIN_PARAM)
  const preset = search.get(PERIOD_PARAM)
  if (!isGrain(grain) || preset === null) return null
  if (preset === CUSTOM) {
    const start = search.get(START_PARAM)
    const end = search.get(END_PARAM)
    if (start === null || end === null || !ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) return null
    return { grain, period: { preset: CUSTOM, start, end } }
  }
  return isPresetId(preset) ? { grain, period: { preset } } : null
}
