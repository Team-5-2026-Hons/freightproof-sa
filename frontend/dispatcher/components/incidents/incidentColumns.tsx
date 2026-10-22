'use client'

import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { RecordLink } from '@/components/ui/RecordLink'
import type { TableColumn } from '@/components/ui/Table'
import { ROUTES } from '@/lib/constants/routes'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import { fmtAge } from '@/lib/format/period'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentStatusChip } from './IncidentStatusChip'

// Columns scale up to fill a wider container but never shrink, so what is shown must add up to no more
// than the container or the table scrolls sideways and clips its last column. Each optional column
// therefore hides below the width at which everything before it still fits:
//   core (reference + type + status + summary)  660
//   + received                                  770   hides below 800
//   + unresolved                                880   hides below 900
//   + investigated by                          1030   hides below 1100
// The summary is the widest, so it takes the largest share when the screen is wider than that.
const REFERENCE_WIDTH_PX = 170
const TYPE_WIDTH_PX = 120
const STATUS_WIDTH_PX = 130
const SUMMARY_WIDTH_PX = 240
const RECEIVED_WIDTH_PX = 110
const RECEIVED_HIDE_BELOW_PX = 800
const CARGO_WIDTH_PX = 110
const CARGO_HIDE_BELOW_PX = 900
const OWNER_WIDTH_PX = 150
const OWNER_HIDE_BELOW_PX = 1100

/** The Incidents list's columns. `now` ages the Received column, which counts up without a refetch. */
export function buildIncidentColumns(now: Date): TableColumn<IncidentSummary>[] {
  return [
    { id: 'reference', label: 'Incident', width: REFERENCE_WIDTH_PX, sortable: true, render: i => <RecordLink href={ROUTES.incidentDetail(i.incident_id)} className="tabular-nums">{i.trip_reference} · {i.reference}</RecordLink> },
    { id: 'type', label: 'Type', width: TYPE_WIDTH_PX, sortable: true, render: i => INCIDENT_TYPE_LABELS[i.incident_type] },
    { id: 'status', label: 'Status', width: STATUS_WIDTH_PX, sortable: true, render: i => <IncidentStatusChip status={i.status} /> },
    { id: 'summary', label: 'What was reported', width: SUMMARY_WIDTH_PX, render: i => <span className="line-clamp-2">{i.summary}</span> },
    {
      id: 'received', label: 'Received', width: RECEIVED_WIDTH_PX, hideBelow: RECEIVED_HIDE_BELOW_PX, sortable: true,
      // The full date and time clipped at laptop widths; the age fits, and the exact time stays on hover.
      render: i => (
        <span className="whitespace-nowrap tabular-nums" title={fmtSastDateTime(i.received_at) ?? undefined}>
          {Number.isFinite(Date.parse(i.received_at)) ? `${fmtAge(i.received_at, now)} ago` : '—'}
        </span>
      ),
    },
    { id: 'cargo', label: 'Unresolved', width: CARGO_WIDTH_PX, hideBelow: CARGO_HIDE_BELOW_PX, sortable: true, render: i => i.parcels_total === 0 ? '—' : `${i.parcels_unresolved} of ${i.parcels_total}` },
    { id: 'owner', label: 'Investigated by', width: OWNER_WIDTH_PX, hideBelow: OWNER_HIDE_BELOW_PX, sortable: true, render: i => i.assigned_to_name ?? 'Unassigned' },
  ]
}
