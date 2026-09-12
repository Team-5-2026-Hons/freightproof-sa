'use client'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { NO_DATA, fmtRate } from '@/lib/format/analytics'
import { useSortedRows } from '@/lib/hooks/useSortedRows'
import type { FacilityMetrics } from '@shared/lib/types/analytics'
import { ANALYTICS_COPY } from './copy'

export interface FacilityPanelProps {
  rows: FacilityMetrics[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

// "Confirmed ✓" / "Mismatch ✗" match PhaseLocationSection so the verdicts read the same
// across the app. Unwitnessed deliberately does NOT reuse its "Awaiting Pulsit": that is
// live-trip copy, and on a closed trip the reading was never taken (spec §0 #18).
const COLUMNS: Column<FacilityMetrics>[] = [
  {
    key: 'precinct_name', label: 'Precinct', sortable: true,
    render: (_, row) => row.precinct_name ?? NO_DATA,
  },
  {
    key: 'corroboration_rate', label: 'Corroboration rate', sortable: true,
    render: (_, row) => fmtRate(
      row.corroboration_rate, row.confirmed_count, row.confirmed_count + row.mismatch_count,
    ),
  },
  { key: 'confirmed_count', label: 'Confirmed ✓', sortable: true },
  { key: 'mismatch_count', label: 'Mismatch ✗', sortable: true },
  { key: 'unwitnessed_count', label: 'Unwitnessed (no Pulsit reading)', sortable: true },
]

/** Pulsit corroboration per precinct. First tab on purpose: entirely non-personal, and
 *  the control that stops driver numbers being read naively — if one depot corroborates
 *  at 40%, the problem is the depot, not its drivers. */
export function FacilityPanel({ rows, isLoading, error, onRetry }: FacilityPanelProps) {
  const sorted = useSortedRows(rows, { key: 'precinct_name', dir: 'asc' })

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
      <p className="text-[12px] text-on-surf-v">{ANALYTICS_COPY.facilityRateNote}</p>
    </div>
  )
}
