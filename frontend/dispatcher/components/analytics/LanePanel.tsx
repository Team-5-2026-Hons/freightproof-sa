'use client'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtMinutes, fmtRatio, fmtScheduleDelta } from '@/lib/format/analytics'
import { readSortValue, useSortedRows, type SortValue } from '@/lib/hooks/useSortedRows'
import type { DurationStats, LaneMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'

export interface LanePanelProps {
  rows: LaneMetrics[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

function laneLabel(row: LaneMetrics): string {
  return `${row.origin_precinct_name ?? NO_DATA} → ${row.destination_precinct_name ?? NO_DATA}`
}

interface DurationCellProps {
  stats: DurationStats
  format: (minutes: number | null) => string
}

/** Median and P90 first — the typical trip and the bad one — with mean, range and sample
 *  size beneath, so a figure from a single trip is never mistaken for a pattern. */
function DurationCell({ stats, format }: DurationCellProps) {
  if (stats.sample_count === 0) return <span>{NO_DATA}</span>
  return (
    <div className="flex flex-col gap-[2px]">
      <span>Median {format(stats.median)} · P90 {format(stats.p90)}</span>
      <span className="text-[11px] text-on-surf-v">
        Mean {format(stats.mean)} · {format(stats.minimum)} to {format(stats.maximum)} ·{' '}
        {stats.sample_count} {stats.sample_count === 1 ? 'trip' : 'trips'}
      </span>
    </div>
  )
}

const COLUMNS: Column<LaneMetrics>[] = [
  {
    key: 'origin_precinct_name', label: 'Lane', sortable: true,
    render: (_, row) => laneLabel(row),
  },
  { key: 'trip_count', label: 'Trips', sortable: true },
  {
    key: 'exception_density', label: 'Exceptions per trip', sortable: true,
    render: (_, row) => fmtRatio(row.exception_density, row.exception_count, row.trip_count),
  },
  {
    key: 'actual_transit_minutes', label: 'Transit time', sortable: true,
    render: (_, row) => <DurationCell stats={row.actual_transit_minutes} format={fmtMinutes} />,
  },
  {
    key: 'schedule_delta_minutes', label: 'Against schedule', sortable: true,
    render: (_, row) => <DurationCell stats={row.schedule_delta_minutes} format={fmtScheduleDelta} />,
  },
]

// The lane column sorts by its displayed label, and the two distributions by their
// median — the figure each cell leads with.
function laneSortValue(row: LaneMetrics, key: keyof LaneMetrics): SortValue {
  switch (key) {
    case 'origin_precinct_name': return laneLabel(row)
    case 'actual_transit_minutes': return row.actual_transit_minutes.median
    case 'schedule_delta_minutes': return row.schedule_delta_minutes.median
    default: return readSortValue(row, key)
  }
}

/** Origin -> destination lanes: how long the route takes, and whether it keeps its plan. */
export function LanePanel({ rows, isLoading, error, onRetry }: LanePanelProps) {
  const sorted = useSortedRows(rows, { key: 'origin_precinct_name', dir: 'asc' }, laneSortValue)

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
      <p className="text-[12px] text-on-surf-v">{ANALYTICS_COPY.laneNote}</p>
    </div>
  )
}
