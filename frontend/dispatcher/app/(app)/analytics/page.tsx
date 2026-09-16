'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { FleetTiles } from '@/components/analytics/fleet/FleetTiles'
import { ControlRow, type TabControls } from '@/components/analytics/fleet/controls/ControlRow'
import { FLEET_COPY } from '@/components/analytics/fleet/copy'
import {
  TAB_PARAM,
  analyticsReturnHref,
  controlsFromSearch,
  hasReturnedControls,
} from '@/components/analytics/fleet/navigation'
import { ActivityTab } from '@/components/analytics/fleet/tabs/ActivityTab'
import { EvidenceTab } from '@/components/analytics/fleet/tabs/EvidenceTab'
import { OnTimeTab } from '@/components/analytics/fleet/tabs/OnTimeTab'
import { ProblemsTab } from '@/components/analytics/fleet/tabs/ProblemsTab'
import { ReviewDeskTab } from '@/components/analytics/fleet/tabs/ReviewDeskTab'
import { RoutesTab } from '@/components/analytics/fleet/tabs/RoutesTab'
import { Spinner } from '@/components/ui/Spinner'
import { Tabs, type Tab } from '@/components/ui/Tabs'
import { TopBar } from '@/components/ui/TopBar'
import {
  GENERAL_PRESETS,
  periodForGrain,
  resolveTabQuery,
  todaySast,
  type PeriodSelection,
} from '@/lib/format/period'
import { useFleetTiles } from '@/lib/hooks/useFleetAnalytics'

// Fleet-wide patterns and trends (fleet analytics spec). Per-entity numbers live on each
// vehicle, driver and precinct detail page, so this page answers "how is the whole
// operation doing": headline tiles, then one tab per section (layout b, spec D2).
const TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'on-time', label: 'On time' },
  { id: 'problems', label: 'Problems' },
  { id: 'review', label: 'Review desk' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'routes', label: 'Routes & sites' },
] as const satisfies readonly Tab[]

type TabId = (typeof TABS)[number]['id']

const DEFAULT_TAB: TabId = 'activity'
const PANEL_ID = 'fleet-analytics-panel'

// Routes & sites shows distributions over the whole period, never a time axis (spec D4).
const TABS_WITHOUT_GRAIN: readonly TabId[] = ['routes']

const DEFAULT_CONTROLS: TabControls = { grain: 'week', period: { preset: 'last_12_weeks' } }

const INITIAL_CONTROLS: Record<TabId, TabControls> = {
  activity: DEFAULT_CONTROLS,
  'on-time': DEFAULT_CONTROLS,
  problems: DEFAULT_CONTROLS,
  review: DEFAULT_CONTROLS,
  evidence: DEFAULT_CONTROLS,
  routes: DEFAULT_CONTROLS,
}

// Busy patterns need lots of history to mean anything, so they default to All time (spec D5).
const DEFAULT_PATTERN_PERIOD: PeriodSelection = { preset: 'all_time' }

function isTabId(id: string | null): id is TabId {
  return TABS.some((tab) => tab.id === id)
}

/** Every tab's controls, with the tab the dispatcher came back to set as they left it (D25).
 *  A period the tab can't offer (a View by preset on Routes & sites, or one that doesn't suit
 *  the View by) falls back to what the tab would have chosen itself. */
function initialControls(tab: TabId, search: URLSearchParams): Record<TabId, TabControls> {
  const returned = controlsFromSearch(search)
  if (returned === null) return INITIAL_CONTROLS
  const { period } = returned
  let fitted: TabControls
  if (!TABS_WITHOUT_GRAIN.includes(tab)) {
    fitted = { ...returned, period: periodForGrain(period, returned.grain) }
  } else if (period.preset === 'custom' || GENERAL_PRESETS.includes(period.preset)) {
    fitted = returned
  } else {
    fitted = DEFAULT_CONTROLS
  }
  return { ...INITIAL_CONTROLS, [tab]: fitted }
}

export default function AnalyticsPage() {
  // useSearchParams needs a Suspense boundary, or `next build` refuses to prerender the route.
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner size="lg" /></div>}>
      <FleetAnalytics />
    </Suspense>
  )
}

function FleetAnalytics() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const requested = search.get(TAB_PARAM)
  // The tab lives in the URL so a link can open one directly (e.g. Back from a report opened on the map).
  const active: TabId = isTabId(requested) ? requested : DEFAULT_TAB

  const tiles = useFleetTiles()
  const [controls, setControls] = useState<Record<TabId, TabControls>>(() => initialControls(active, search))
  const [patternPeriod, setPatternPeriod] = useState<PeriodSelection>(DEFAULT_PATTERN_PERIOD)
  const today = todaySast()
  const allTimeStart = tiles.data?.all_time_start ?? null
  const activeControls = controls[active]
  const query = resolveTabQuery(activeControls.period, activeControls.grain, today, allTimeStart)

  // Once the returned-to choices are in state, tidy the address back to just the tab, so a
  // later refresh follows what's on screen rather than what the dispatcher came back with.
  useEffect(() => {
    if (hasReturnedControls(search)) router.replace(`${pathname}?${TAB_PARAM}=${active}`, { scroll: false })
  }, [search, router, pathname, active])

  function selectTab(id: string): void {
    if (!isTabId(id)) return
    // replace, not push: flicking between tabs shouldn't fill the Back button's history.
    router.replace(`${pathname}?${TAB_PARAM}=${id}`, { scroll: false })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Analytics" />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex flex-col gap-4 px-6 py-4">
          <FleetTiles data={tiles.data} isLoading={tiles.isLoading} error={tiles.error} onRetry={tiles.refetch} />

          <Tabs tabs={TABS} active={active} onChange={selectTab} panelId={PANEL_ID} ariaLabel="Analytics sections" />

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0} className="flex flex-col gap-4 focus-visible:outline-none">
            <ControlRow
              controls={activeControls}
              query={query}
              onChange={(next) => setControls((current) => ({ ...current, [active]: next }))}
              showGrain={!TABS_WITHOUT_GRAIN.includes(active)}
              today={today}
              allTimeStart={allTimeStart}
            />
            <p className="text-[12px] text-on-surf-v">{FLEET_COPY.scopeNote}</p>
            {/* Only the open tab is mounted, so only its requests run (spec D2). */}
            {active === 'activity' && (
              <ActivityTab
                query={query}
                allTimeStart={allTimeStart}
                today={today}
                patternPeriod={patternPeriod}
                onPatternPeriodChange={setPatternPeriod}
              />
            )}
            {active === 'on-time' && <OnTimeTab query={query} allTimeStart={allTimeStart} today={today} />}
            {active === 'problems' && <ProblemsTab query={query} allTimeStart={allTimeStart} today={today} />}
            {active === 'review' && <ReviewDeskTab query={query} allTimeStart={allTimeStart} today={today} />}
            {active === 'evidence' && <EvidenceTab query={query} allTimeStart={allTimeStart} today={today} />}
            {active === 'routes' && <RoutesTab query={query} returnTo={analyticsReturnHref(active, activeControls)} />}
          </div>
        </div>
      </div>
    </div>
  )
}
