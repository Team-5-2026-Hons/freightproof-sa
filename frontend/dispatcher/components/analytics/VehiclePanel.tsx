'use client'

import { useMemo } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtHours, fmtMinutes, fmtOptionalCount } from '@/lib/format/analytics'
import { VEHICLE_TYPE_LABELS } from '@/lib/format/vehicle'
import { useSortedRows } from '@/lib/hooks/useSortedRows'
import type { VehicleMetrics, VehicleStreak } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'

export interface VehiclePanelProps {
  vehicles: VehicleMetrics[]
  streaks: VehicleStreak[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

/** A vehicle's monthly numbers with its whole-history streak figures beside them. The
 *  streak fields are null only if the streaks response has no row for the vehicle. */
export interface VehicleRow extends VehicleMetrics {
  highest_streak_trips: number | null
  lowest_streak_trips: number | null
  trips_since_last_incident: number | null
}

/** Rows are the vehicles with trips in the selected months; streaks join onto them by id.
 *  One streaks request for the whole table, never one per row (spec §3.3). */
export function joinStreaks(vehicles: VehicleMetrics[], streaks: VehicleStreak[]): VehicleRow[] {
  const byVehicle = new Map(streaks.map((streak) => [streak.vehicle_id, streak]))
  return vehicles.map((vehicle) => {
    const streak = byVehicle.get(vehicle.vehicle_id)
    return {
      ...vehicle,
      highest_streak_trips: streak?.highest_streak_trips ?? null,
      lowest_streak_trips: streak?.lowest_streak_trips ?? null,
      trips_since_last_incident: streak?.trips_since_last_incident ?? null,
    }
  })
}

// Severities are separate columns and never summed (spec §2 rule 4).
const COLUMNS: Column<VehicleRow>[] = [
  {
    key: 'registration', label: 'Registration', sortable: true,
    render: (_, row) => row.registration ?? NO_DATA,
  },
  {
    // Horses and trailers share this table, so every row says which it is.
    key: 'vehicle_type', label: 'Type', sortable: true,
    render: (_, row) => (row.vehicle_type ? VEHICLE_TYPE_LABELS[row.vehicle_type] : NO_DATA),
  },
  { key: 'trip_count', label: 'Trips', sortable: true },
  { key: 'mechanical_info_count', label: 'Mechanical (info)', sortable: true },
  { key: 'mechanical_warning_count', label: 'Mechanical (warning)', sortable: true },
  { key: 'mechanical_critical_count', label: 'Mechanical (critical)', sortable: true },
  {
    key: 'mean_minutes_between_mechanical', label: 'Mean time between breakdowns', sortable: true,
    render: (_, row) => fmtMinutes(row.mean_minutes_between_mechanical),
  },
  {
    key: 'driving_hours_sum', label: 'Driving time', sortable: true,
    render: (_, row) => fmtHours(row.driving_hours_sum),
  },
  {
    key: 'highest_streak_trips', label: 'Longest clean streak', sortable: true,
    render: (_, row) => fmtOptionalCount(row.highest_streak_trips),
  },
  {
    key: 'lowest_streak_trips', label: 'Shortest completed streak', sortable: true,
    render: (_, row) => fmtOptionalCount(row.lowest_streak_trips),
  },
  {
    key: 'trips_since_last_incident', label: 'Trips since last incident', sortable: true,
    render: (_, row) => fmtOptionalCount(row.trips_since_last_incident),
  },
]

/** Horses and trailers in one table (trailer analytics spec). Answers "the driver's fault
 *  or the vehicle's?". */
export function VehiclePanel({ vehicles, streaks, isLoading, error, onRetry }: VehiclePanelProps) {
  const rows = useMemo(() => joinStreaks(vehicles, streaks), [vehicles, streaks])
  const sorted = useSortedRows(rows, { key: 'registration', dir: 'asc' })

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
      <p className="text-[12px] text-on-surf-v">{ANALYTICS_COPY.streaksNote}</p>
      <p className="text-[12px] text-on-surf-v">{ANALYTICS_COPY.trailerNote}</p>
    </div>
  )
}
