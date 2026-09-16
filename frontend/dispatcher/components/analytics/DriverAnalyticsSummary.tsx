'use client'

import { useState } from 'react'

import { fmtMinutes, fmtRate } from '@/lib/format/analytics'
import { defaultMonthRange, fmtMonthRange } from '@/lib/format/month'
import { useDriverAnalytics } from '@/lib/hooks/useAnalytics'
import type { MonthRange } from '@/lib/types/month-range'
import type { DriverMetrics } from '@shared/lib/types/analytics'
import type { DriverId } from '@shared/lib/types/driver'
import { ANALYTICS_COPY } from './copy'
import {
  AnalyticsSummaryFrame, DetailRow, EmptyNote, ListRow, ListRows, SectionDivider,
  SectionHeading, SeverityStrip, StatTile, StatTiles,
} from './SummaryParts'

export interface DriverAnalyticsSummaryProps {
  driverId: DriverId
}

// No "Avg" prefix on the phase names — the section heading already says "Average time in each phase".
const LABELS = {
  trips: 'Trips',
  onTimeDepartures: 'On-time departures',
  dispatcherOverrides: 'Dispatcher overrides',
  tripsWithExceptions: 'Trips with exceptions',
} as const

const SUMMARY_COPY = {
  monthsHeading: 'Selected months',
  exceptionsHeading: 'Exceptions',
  phasesHeading: 'Average time in each phase',
} as const

type DwellAverageKey =
  | 'activation_dwell_minutes_avg'
  | 'loading_dwell_minutes_avg'
  | 'departure_dwell_minutes_avg'
  | 'unloading_dwell_minutes_avg'
  | 'confirmation_dwell_minutes_avg'

interface PhaseRow {
  label: string
  key: DwellAverageKey
  note?: string
}

// In phase order; in_transit and trip_creation are never driver dwell.
const PHASE_ROWS: readonly PhaseRow[] = [
  { label: 'Activation', key: 'activation_dwell_minutes_avg' },
  { label: 'Loading', key: 'loading_dwell_minutes_avg' },
  { label: 'Departure', key: 'departure_dwell_minutes_avg' },
  { label: 'Unloading', key: 'unloading_dwell_minutes_avg' },
  // The caveat sits with this one figure, not a footnote: a slow receiver also lengthens it.
  { label: 'Confirmation', key: 'confirmation_dwell_minutes_avg', note: ANALYTICS_COPY.confirmationDwellCaveat },
]

/** One driver's analytics on their own detail page, as stat tiles (a one-row table would read
 *  as broken UI). Only severity cells carry colour; rates and times stay neutral so they never
 *  read as a judgement of the driver. Filters the org's full list client-side — the endpoint
 *  has no per-driver filter yet. */
export function DriverAnalyticsSummary({ driverId }: DriverAnalyticsSummaryProps) {
  const [range, setRange] = useState<MonthRange>(() => defaultMonthRange())
  const drivers = useDriverAnalytics(range)

  return (
    <AnalyticsSummaryFrame
      range={range}
      onRangeChange={setRange}
      isLoading={drivers.isLoading}
      error={drivers.error}
      onRetry={drivers.refetch}
    >
      <Figures
        rangeLabel={fmtMonthRange(range)}
        metrics={drivers.rows.find((row) => row.driver_id === driverId)}
      />
    </AnalyticsSummaryFrame>
  )
}

function Figures({ rangeLabel, metrics }: { rangeLabel: string; metrics: DriverMetrics | undefined }) {
  if (!metrics) {
    return (
      <section>
        <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
        <EmptyNote />
      </section>
    )
  }

  return (
    <>
      <section>
        <SectionHeading title={SUMMARY_COPY.monthsHeading} detail={rangeLabel} />
        <StatTiles>
          <StatTile label={LABELS.trips} value={String(metrics.trip_count)} accent />
          <StatTile
            label={LABELS.onTimeDepartures}
            value={fmtRate(metrics.on_time_departure_rate, metrics.on_time_departures_count, metrics.departures_with_plan_count)}
          />
        </StatTiles>
        <DetailRow
          label={LABELS.dispatcherOverrides}
          value={fmtRate(metrics.override_rate, metrics.override_count, metrics.phase_events_count)}
        />
      </section>

      <section>
        <SectionHeading title={SUMMARY_COPY.exceptionsHeading} />
        <SeverityStrip
          counts={{
            info: metrics.info_exceptions_count,
            warning: metrics.warning_exceptions_count,
            critical: metrics.critical_exceptions_count,
          }}
        />
        <DetailRow
          label={LABELS.tripsWithExceptions}
          value={fmtRate(metrics.exception_trip_rate, metrics.trips_with_exceptions_count, metrics.trip_count)}
        />
      </section>

      <SectionDivider />

      <section>
        <SectionHeading title={SUMMARY_COPY.phasesHeading} />
        <ListRows>
          {PHASE_ROWS.map((row) => (
            <ListRow key={row.key} label={row.label} value={fmtMinutes(metrics[row.key])} note={row.note} />
          ))}
        </ListRows>
      </section>
    </>
  )
}
