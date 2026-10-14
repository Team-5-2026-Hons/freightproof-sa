'use client'

import {
  GENERAL_PRESETS,
  PRESETS_BY_GRAIN,
  periodForGrain,
  type PeriodSelection,
  type TabQuery,
} from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'
import { FLEET_COPY } from '../copy'
import { GrainToggle } from './GrainToggle'
import { PeriodControl } from './PeriodControl'

/** What the dispatcher chose for one tab; kept per tab for the visit so switching tabs and
 *  back does not reset it. */
export interface TabControls {
  grain: Grain
  period: PeriodSelection
}

interface ControlRowProps {
  controls: TabControls
  /** resolveTabQuery(controls, …): worked out once by the page, which also fetches with it. */
  query: TabQuery
  onChange: (controls: TabControls) => void
  /** Tabs with no chart over time (Routes & sites) have a Period but no View by. */
  showGrain: boolean
  today: string
  allTimeStart: string | null
}

/** One row of controls above a tab's charts. The Period only offers presets that suit the
 *  View by; when a period has too many bars for the chosen grain, the row switches to a
 *  coarser one and says why, keeping the original choice so a shorter period restores it. */
export function ControlRow({ controls, query, onChange, showGrain, today, allTimeStart }: ControlRowProps) {
  const presets = showGrain ? PRESETS_BY_GRAIN[controls.grain] : GENERAL_PRESETS

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-4">
        {showGrain && (
          <GrainToggle
            value={query.grain}
            disabled={query.disabledGrains}
            onChange={(grain) => onChange({ grain, period: periodForGrain(controls.period, grain) })}
          />
        )}
        <PeriodControl
          value={controls.period}
          onChange={(period) => onChange({ ...controls, period })}
          today={today}
          allTimeStart={allTimeStart}
          presets={presets}
        />
      </div>
      {showGrain && query.grainAdjusted && (
        <p role="status" className="text-[12px] text-on-surf-v">
          {FLEET_COPY.controls.grainSwitched(controls.grain, query.grain)}
        </p>
      )}
    </div>
  )
}
