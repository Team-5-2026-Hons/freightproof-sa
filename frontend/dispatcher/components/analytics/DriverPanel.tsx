'use client'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtMinutes, fmtRate } from '@/lib/format/analytics'
import { useSortedRows } from '@/lib/hooks/useSortedRows'
import type { DriverMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'

export interface DriverPanelProps {
  rows: DriverMetrics[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

// Ties the confirmation column to its caveat, printed directly under the table.
const CAVEAT_MARK = '†'

// Trends only — decision 06. There is no score column because the API has no score to
// show (FP-153 §3 rule 4): severities stay separate counts for the reader to weigh.
const COLUMNS: Column<DriverMetrics>[] = [
  {
    key: 'driver_name', label: 'Driver', sortable: true,
    render: (_, row) => row.driver_name ?? NO_DATA,
  },
  { key: 'trip_count', label: 'Trips', sortable: true },
  {
    key: 'exception_trip_rate', label: 'Trips with exceptions', sortable: true,
    render: (_, row) => fmtRate(row.exception_trip_rate, row.trips_with_exceptions_count, row.trip_count),
  },
  { key: 'info_exceptions_count', label: 'Info exceptions', sortable: true },
  { key: 'warning_exceptions_count', label: 'Warning exceptions', sortable: true },
  { key: 'critical_exceptions_count', label: 'Critical exceptions', sortable: true },
  {
    key: 'on_time_departure_rate', label: 'On-time departures', sortable: true,
    render: (_, row) => fmtRate(
      row.on_time_departure_rate, row.on_time_departures_count, row.departures_with_plan_count,
    ),
  },
  {
    key: 'override_rate', label: 'Dispatcher overrides', sortable: true,
    render: (_, row) => fmtRate(row.override_rate, row.override_count, row.phase_events_count),
  },
  {
    key: 'activation_dwell_minutes_avg', label: 'Avg activation', sortable: true,
    render: (_, row) => fmtMinutes(row.activation_dwell_minutes_avg),
  },
  {
    key: 'loading_dwell_minutes_avg', label: 'Avg loading', sortable: true,
    render: (_, row) => fmtMinutes(row.loading_dwell_minutes_avg),
  },
  {
    key: 'departure_dwell_minutes_avg', label: 'Avg departure', sortable: true,
    render: (_, row) => fmtMinutes(row.departure_dwell_minutes_avg),
  },
  {
    key: 'unloading_dwell_minutes_avg', label: 'Avg unloading', sortable: true,
    render: (_, row) => fmtMinutes(row.unloading_dwell_minutes_avg),
  },
  {
    key: 'confirmation_dwell_minutes_avg', label: `Avg confirmation ${CAVEAT_MARK}`, sortable: true,
    render: (_, row) => fmtMinutes(row.confirmation_dwell_minutes_avg),
  },
]

/** Per-driver trends. The last tab on purpose (FP-156 sequencing): read after the facility
 *  and vehicle tabs, which show when a depot or a truck is the real cause. Sorted by name
 *  by default so the table never opens as a ranking of drivers. */
export function DriverPanel({ rows, isLoading, error, onRetry }: DriverPanelProps) {
  const sorted = useSortedRows(rows, { key: 'driver_name', dir: 'asc' })

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        columns={COLUMNS}
        rows={sorted.rows}
        sort={sorted.sort}
        onSort={sorted.onSort}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        empty={ANALYTICS_COPY.empty}
      />
      <p className="text-[12px] text-on-surf-v">
        {CAVEAT_MARK} Avg confirmation: {ANALYTICS_COPY.confirmationDwellCaveat}
      </p>
    </div>
  )
}
