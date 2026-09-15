// Getting back to the Analytics page from a detail page it links to (D25).
//
// Tom's rule: from an exception opened on the incident map, Back must land on the same tab with
// the same View by and Period, not on the page's defaults. The return address carries those
// choices, rather than the browser's storage, so the server and the browser draw the same first
// frame and a refresh of the returned-to page keeps them too.

import { ROUTES } from '@/lib/constants/routes'
import { GENERAL_PRESETS, GRAINS, PRESETS_BY_GRAIN, type PresetId } from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'
import type { TabControls } from './controls/ControlRow'

/** The page's own tab parameter: shared, so the return address and the tabs agree. */
export const TAB_PARAM = 'tab'
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
 *  "/analytics?tab=routes&grain=week&period=last_26_weeks". */
export function analyticsReturnHref(tab: string, controls: TabControls): string {
  const params = new URLSearchParams({
    [TAB_PARAM]: tab,
    [GRAIN_PARAM]: controls.grain,
    [PERIOD_PARAM]: controls.period.preset,
  })
  if (controls.period.preset === CUSTOM) {
    params.set(START_PARAM, controls.period.start)
    params.set(END_PARAM, controls.period.end)
  }
  return `${ROUTES.analytics}?${params.toString()}`
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
