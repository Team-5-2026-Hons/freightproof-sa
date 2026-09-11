'use client'

import { useState } from 'react'

import { DriverPanel } from '@/components/analytics/DriverPanel'
import { FacilityPanel } from '@/components/analytics/FacilityPanel'
import { LanePanel } from '@/components/analytics/LanePanel'
import { VehiclePanel } from '@/components/analytics/VehiclePanel'
import { ANALYTICS_COPY } from '@/components/analytics/copy'
import { MonthRangePicker } from '@/components/ui/MonthRangePicker'
import { SecHead } from '@/components/ui/SecHead'
import { Tabs, type Tab } from '@/components/ui/Tabs'
import { TopBar } from '@/components/ui/TopBar'
import { defaultMonthRange } from '@/lib/format/month'
import {
  useDriverAnalytics,
  useFacilityAnalytics,
  useLaneAnalytics,
  useVehicleAnalytics,
  useVehicleStreaks,
} from '@/lib/hooks/useAnalytics'
import type { MonthRange } from '@/lib/types/month-range'

// FP-156 sequencing (Ciaran's comment on the ticket): facility first — non-personal, and
// the control that stops driver numbers being read naively — and driver last.
const TABS = [
  { id: 'facility', label: 'Facility' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'lane', label: 'Lane' },
  { id: 'driver', label: 'Driver' },
] as const satisfies readonly Tab[]

type TabId = (typeof TABS)[number]['id']

const SECTION_TITLES: Record<TabId, string> = {
  facility: 'Pulsit corroboration by precinct',
  vehicle: 'Vehicles',
  lane: 'Lanes',
  driver: 'Driver trends',
}

const PANEL_ID = 'analytics-panel'

function isTabId(id: string): id is TabId {
  return TABS.some((tab) => tab.id === id)
}

interface GrainTabProps {
  range: MonthRange
}

// One small connector per tab: the panels stay presentational (data as props), and only
// the tab on screen fetches, rather than all five requests on every visit.
function FacilityTab({ range }: GrainTabProps) {
  const facilities = useFacilityAnalytics(range)
  return (
    <FacilityPanel
      rows={facilities.rows} isLoading={facilities.isLoading}
      error={facilities.error} onRetry={facilities.refetch}
    />
  )
}

function VehicleTab({ range }: GrainTabProps) {
  const vehicles = useVehicleAnalytics(range)
  const streaks = useVehicleStreaks()

  // Retry only what failed, so a good response is not thrown away and re-requested.
  function retry(): void {
    if (vehicles.error) vehicles.refetch()
    if (streaks.error) streaks.refetch()
  }

  return (
    <VehiclePanel
      vehicles={vehicles.rows} streaks={streaks.rows}
      isLoading={vehicles.isLoading || streaks.isLoading}
      error={vehicles.error ?? streaks.error} onRetry={retry}
    />
  )
}

function LaneTab({ range }: GrainTabProps) {
  const lanes = useLaneAnalytics(range)
  return (
    <LanePanel
      rows={lanes.rows} isLoading={lanes.isLoading} error={lanes.error} onRetry={lanes.refetch}
    />
  )
}

function DriverTab({ range }: GrainTabProps) {
  const drivers = useDriverAnalytics(range)
  return (
    <DriverPanel
      rows={drivers.rows} isLoading={drivers.isLoading} error={drivers.error} onRetry={drivers.refetch}
    />
  )
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<MonthRange>(() => defaultMonthRange())
  const [active, setActive] = useState<TabId>('facility')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Analytics" />

      <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-3 shrink-0">
        <MonthRangePicker value={range} onChange={setRange} />
        <p className="max-w-md text-[12px] text-on-surf-v">{ANALYTICS_COPY.scopeNote}</p>
      </div>

      <div className="px-6 pb-3 shrink-0">
        <Tabs
          tabs={TABS}
          active={active}
          onChange={(id) => { if (isTabId(id)) setActive(id) }}
          panelId={PANEL_ID}
          ariaLabel="Analytics view"
        />
      </div>

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-auto mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 flex flex-col"
      >
        <SecHead title={SECTION_TITLES[active]} />
        <div className="p-4">
          {active === 'facility' && <FacilityTab range={range} />}
          {active === 'vehicle' && <VehicleTab range={range} />}
          {active === 'lane' && <LaneTab range={range} />}
          {active === 'driver' && <DriverTab range={range} />}
        </div>
      </div>
    </div>
  )
}
