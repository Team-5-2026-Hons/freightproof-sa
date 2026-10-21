'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sparkles } from 'lucide-react'

import { AnalyticsChatPanel } from '@/components/analytics/chat/AnalyticsChatPanel'
import { CHAT_COPY } from '@/components/analytics/chat/chatCopy'
import { FleetTiles } from '@/components/analytics/fleet/FleetTiles'
import { ControlRow, type TabControls } from '@/components/analytics/fleet/controls/ControlRow'
import { COST_COPY } from '@/components/analytics/fleet/costCopy'
import { FLEET_COPY } from '@/components/analytics/fleet/copy'
import {
  TAB_PARAM,
  analyticsReturnHref,
  controlsFromSearch,
  hasReturnedControls,
  mapWindowFromSearch,
  type MapWindow,
} from '@/components/analytics/fleet/navigation'
import { ActivityTab } from '@/components/analytics/fleet/tabs/ActivityTab'
import { CostTab } from '@/components/analytics/fleet/tabs/CostTab'
import { EvidenceTab } from '@/components/analytics/fleet/tabs/EvidenceTab'
import { OnTimeTab } from '@/components/analytics/fleet/tabs/OnTimeTab'
import { ProblemsTab } from '@/components/analytics/fleet/tabs/ProblemsTab'
import { ReviewDeskTab } from '@/components/analytics/fleet/tabs/ReviewDeskTab'
import { RoutesTab } from '@/components/analytics/fleet/tabs/RoutesTab'
import { Button } from '@/components/ui/Button'
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
import { useChatStatus } from '@/lib/hooks/useAnalyticsChat'
import { useFleetTiles } from '@/lib/hooks/useFleetAnalytics'
import type { Basis } from '@shared/lib/types/analytics-chat'

// Fleet-wide patterns and trends. Per-entity numbers live on each
// vehicle, driver and precinct detail page, so this page answers "how is the whole
// operation doing": headline tiles, then one tab per section.
const TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'on-time', label: 'On time' },
  { id: 'problems', label: 'Problems' },
  { id: 'review', label: 'Review desk' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'routes', label: 'Routes & sites' },
  { id: 'cost', label: 'Cost' },
] as const satisfies readonly Tab[]

type TabId = (typeof TABS)[number]['id']

const DEFAULT_TAB: TabId = 'activity'
const PANEL_ID = 'fleet-analytics-panel'
const CHAT_BUTTON_ID = 'analytics-chat-open'
// The design system's size for a button's leading icon (DESIGN_SYSTEM.md §6).
const CHAT_ICON_SIZE = 13
const CHAT_PANEL_ID = 'analytics-chat-panel'

// Routes & sites shows distributions over the whole period, never a time axis.
const TABS_WITHOUT_GRAIN: readonly TabId[] = ['routes']

const DEFAULT_CONTROLS: TabControls = { grain: 'week', period: { preset: 'last_12_weeks' } }

const INITIAL_CONTROLS: Record<TabId, TabControls> = {
  activity: DEFAULT_CONTROLS,
  'on-time': DEFAULT_CONTROLS,
  problems: DEFAULT_CONTROLS,
  review: DEFAULT_CONTROLS,
  evidence: DEFAULT_CONTROLS,
  routes: DEFAULT_CONTROLS,
  cost: DEFAULT_CONTROLS,
}

// Every tab shares the page's two notes; a few add one of their own after them.
const PAGE_NOTES: readonly string[] = [FLEET_COPY.scopeNote, FLEET_COPY.dataNote]
const TAB_NOTES: Partial<Record<TabId, string>> = {
  problems: FLEET_COPY.problems.tabNote,
  review: FLEET_COPY.review.tabNote,
  cost: COST_COPY.tabNote,
}

function notesFor(tab: TabId): readonly string[] {
  const tabNote = TAB_NOTES[tab]
  return tabNote === undefined ? PAGE_NOTES : [...PAGE_NOTES, tabNote]
}

// Busy patterns need lots of history to mean anything, so they default to All time.
const DEFAULT_PATTERN_PERIOD: PeriodSelection = { preset: 'all_time' }

function isTabId(id: string | null): id is TabId {
  return TABS.some((tab) => tab.id === id)
}

/** Every tab's controls, with the tab the dispatcher came back to set as they left it.
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
  const chatStatus = useChatStatus()
  const [chatOpen, setChatOpen] = useState(false)
  const [controls, setControls] = useState<Record<TabId, TabControls>>(() => initialControls(active, search))
  const [patternPeriod, setPatternPeriod] = useState<PeriodSelection>(DEFAULT_PATTERN_PERIOD)
  // Seeded from the address once, so /analytics?tab=routes&map=today opens on Today and Back
  // from a report returns to it. The tidy-address effect below then drops the parameter: the
  // choice lives in state from here on, exactly as the View by and Period choices do.
  const [mapWindow, setMapWindow] = useState<MapWindow>(() => mapWindowFromSearch(search))
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

  const closeChat = useCallback(() => {
    setChatOpen(false)
    // Back to the button that opened it, so keyboard users don't lose their place.
    // By id because the shared Button takes no ref; it stays on screen while the panel is open.
    document.getElementById(CHAT_BUTTON_ID)?.focus()
  }, [])

  /** A chat answer's "Based on" line: show its tab with the answer's exact dates, so the
   *  figure can be checked on the chart beside the panel (FP-295). Set in state rather than
   *  by link, because the page reads the period from the address only when it first loads. */
  function openBasis(basis: Basis): void {
    const tab = basis.tab
    if (tab === null || !isTabId(tab) || basis.start === null || basis.end === null) return
    const { start, end } = basis
    setControls((current) => ({
      ...current,
      [tab]: { grain: basis.grain ?? current[tab].grain, period: { preset: 'custom', start, end } },
    }))
    selectTab(tab)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Analytics">
        {chatStatus.enabled && (
          <Button
            id={CHAT_BUTTON_ID}
            variant="secondary"
            size="sm"
            // The sparkle is the common mark for an AI feature, so the button says what it opens
            // at a glance. Decorative: the words already name the button for screen readers.
            iconLeft={<Sparkles aria-hidden="true" data-testid="chat-sparkle" fill="currentColor" size={CHAT_ICON_SIZE} />}
            aria-expanded={chatOpen}
            aria-controls={chatOpen ? CHAT_PANEL_ID : undefined}
            onClick={() => {
              // Re-read this month's spend: the page's own read is from when it loaded, so a panel
              // opened later would otherwise show an old figure until its first answer arrives.
              chatStatus.refetch()
              setChatOpen(true)
            }}
          >
            {CHAT_COPY.open}
          </Button>
        )}
      </TopBar>

      {/* The chat panel sits beside the scrolling page, not over it, so charts stay visible. */}
      <div className="flex flex-1 min-h-0">
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
                notes={notesFor(active)}
              />
              {/* Only the open tab is mounted, so only its requests run. */}
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
              {active === 'cost' && <CostTab query={query} allTimeStart={allTimeStart} today={today} />}
              {active === 'routes' && (
                <RoutesTab
                  query={query}
                  returnTo={analyticsReturnHref(active, activeControls, mapWindow)}
                  today={today}
                  mapWindow={mapWindow}
                  onMapWindowChange={setMapWindow}
                />
              )}
            </div>
          </div>
        </div>
        {chatOpen && (
          <AnalyticsChatPanel
            id={CHAT_PANEL_ID}
            onClose={closeChat}
            statusSpend={chatStatus.spend}
            onRecheckStatus={chatStatus.refetch}
            onOpenBasis={openBasis}
          />
        )}
      </div>
    </div>
  )
}
