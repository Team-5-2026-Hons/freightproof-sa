'use client'

import { useState } from 'react'

import { NO_DATA, fmtHours, fmtMinutes, fmtOptionalCount } from '@/lib/format/analytics'
import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useVehicleAnalytics, useVehicleStreaks } from '@/lib/hooks/useAnalytics'
import type { MonthRange } from '@/lib/types/month-range'
import type { VehicleMetrics, VehicleStreak } from '@shared/lib/types/analytics'
import type { VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { ANALYTICS_COPY } from './copy'
import {
  AnalyticsSummaryFrame, DetailRow, EmptyNote, ListRow, ListRows, SectionDivider,
  SectionHeading, SeverityStrip, StatTile, StatTiles,
} from './SummaryParts'

export interface VehicleAnalyticsSummaryProps {
  vehicleId: VehicleId
  // Only a trailer needs the note that its earlier breakdowns could not be tied to it.
  vehicleType: VehicleType
}

const LABELS = {
  trips: 'Trips',
  drivingTime: 'Driving time',
  meanBetweenBreakdowns: 'Mean time between breakdowns',
  // "Breakdown", not "exception": only a mechanical exception ends a streak.
  longestRun: 'Longest run with no breakdown',
  shortestRun: 'Shortest completed clean run',
  sinceLastBreakdown: 'Trips since the last breakdown',
} as const

const SUMMARY_COPY = {
  monthsHeading: 'Selected months',
  mechanicalHeading: 'Mechanical exceptions',
  historyHeading: 'Whole history',
  // Beside the heading because streaks ignore the month range entirely.
  historyDetail: 'every closed trip this vehicle has run, not the months above',
  noBreakdowns: 'No breakdowns recorded',
  tripOne: 'trip',
  tripMany: 'trips',
} as const

/** One vehicle's analytics, horse or trailer, on its own detail page, as stat tiles (a one-row
 *  table would read as broken UI). Filters the org's full lists client-side — the endpoints
 *  have no per-vehicle filter yet. */
export function VehicleAnalyticsSummary({ vehicleId, vehicleType }: VehicleAnalyticsSummaryProps) {
  const [range, setRange] = useState<MonthRange>(() => defaultMonthRange())
  const vehicles = useVehicleAnalytics(range)
  const streaks = useVehicleStreaks()

  // Retry only what failed, so a good response is not thrown away and re-requested.
  function retry(): void {
    if (vehicles.error) vehicles.refetch()
    if (streaks.error) streaks.refetch()
  }

  return (
    <AnalyticsSummaryFrame
      range={range}
      onRangeChange={setRange}
      isLoading={vehicles.isLoading || streaks.isLoading}
      error={vehicles.error ?? streaks.error}
      onRetry={retry}
    >
      {/* Not joined to the monthly row: streaks cover the vehicle's whole history, so they must
          not be blanked when the selected months hold no closed trips. */}
      <Figures
        rangeLabel={fmtMonthRange(range)}
        monthly={vehicles.rows.find((row) => row.vehicle_id === vehicleId)}
        streak={streaks.rows.find((row) => row.vehicle_id === vehicleId)}
      />
      {/* After both sections: it explains the breakdown figures in each of them. */}
      {vehicleType === 'trailer' && (
        <p className="text-[12px] text-on-surf-v">{ANALYTICS_COPY.trailerNote}</p>
      )}
    </AnalyticsSummaryFrame>
  )
}

interface FiguresProps {
  rangeLabel: string
  monthly: VehicleMetrics | undefined
  streak: VehicleStreak | undefined
}

function Figures({ rangeLabel, monthly, streak }: FiguresProps) {
  return (
    <>
      {monthly ? (
        <MonthlyFigures rangeLabel={rangeLabel} monthly={monthly} />
      ) : (
        <section>
          <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
          <EmptyNote />
        </section>
      )}

      <SectionDivider />

      <section>
        <SectionHeading title={SUMMARY_COPY.historyHeading} detail={SUMMARY_COPY.historyDetail} />
        <ListRows>
          <TripCountRow
            label={LABELS.longestRun} count={streak?.highest_streak_trips ?? null}
            dotClass="bg-ok" figureClass="text-ok"
          />
          <TripCountRow
            label={LABELS.shortestRun} count={streak?.lowest_streak_trips ?? null}
            dotClass="bg-outline-v"
          />
          <TripCountRow
            label={LABELS.sinceLastBreakdown} count={streak?.trips_since_last_incident ?? null}
            dotClass="bg-warn"
          />
        </ListRows>
      </section>
    </>
  )
}

/** The mean's empty value, by why it is empty: "No breakdowns recorded" only when true, else
 *  the usual dash (a vehicle's first-ever breakdown has simply no gap yet). */
function meanBetweenBreakdowns(monthly: VehicleMetrics): string {
  if (monthly.mean_minutes_between_mechanical !== null) {
    return fmtMinutes(monthly.mean_minutes_between_mechanical)
  }
  return monthly.mechanical_exceptions_count === 0 ? SUMMARY_COPY.noBreakdowns : NO_DATA
}

function MonthlyFigures({ rangeLabel, monthly }: { rangeLabel: string; monthly: VehicleMetrics }) {
  return (
    <>
      <section>
        <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
        <StatTiles>
          <StatTile label={LABELS.trips} value={String(monthly.trip_count)} accent />
          <StatTile label={LABELS.drivingTime} value={fmtHours(monthly.driving_hours_sum)} />
        </StatTiles>
      </section>

      <section>
        <SectionHeading title={SUMMARY_COPY.mechanicalHeading} />
        <SeverityStrip
          counts={{
            info: monthly.mechanical_info_count,
            warning: monthly.mechanical_warning_count,
            critical: monthly.mechanical_critical_count,
          }}
        />
        <DetailRow
          label={LABELS.meanBetweenBreakdowns}
          value={meanBetweenBreakdowns(monthly)}
          quiet={monthly.mean_minutes_between_mechanical === null}
        />
      </section>
    </>
  )
}

interface TripCountRowProps {
  label: string
  count: number | null
  dotClass: string
  figureClass?: string
}

function TripCountRow({ label, count, dotClass, figureClass }: TripCountRowProps) {
  const unit = count === null ? undefined : count === 1 ? SUMMARY_COPY.tripOne : SUMMARY_COPY.tripMany
  return (
    <ListRow
      label={label} value={fmtOptionalCount(count)} unit={unit}
      dotClass={dotClass} figureClass={figureClass}
    />
  )
}
