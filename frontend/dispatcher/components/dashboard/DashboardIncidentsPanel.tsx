'use client'

import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { SkeletonBar } from '@/components/ui/Skeleton'
import { Table, type TableColumn } from '@/components/ui/Table'
import { DashboardPanel } from '@/components/dashboard/DashboardPanel'
import { RefreshFailedNote } from '@/components/dashboard/RefreshFailedNote'
import { IncidentStatusChip } from '@/components/incidents/IncidentStatusChip'
import { ROUTES } from '@/lib/constants/routes'
import { openIncidents, PANEL_ROW_LIMIT } from '@/lib/dashboard/attention'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import { fmtAge } from '@/lib/format/period'
import { useIncidents } from '@/lib/hooks/useIncidents'
import { useLastLoadedAt } from '@/lib/hooks/useLastLoadedAt'
import { useNow } from '@/lib/hooks/useNow'
import type { IncidentSummary } from '@/lib/types/incident'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'

const TABLE_ID = 'dashboard-incidents'
const SKELETON_ROWS = PANEL_ROW_LIMIT
const ALL_INCIDENTS = {}
const CLOCK_TICK_MS = 60_000
const RECEIVED_HIDE_BELOW_PX = 540

const CHIP_SKELETON = <SkeletonBar className="h-6 w-20 rounded-md" />

function buildColumns(now: Date): TableColumn<IncidentSummary>[] {
  return [
    {
      id: 'received', label: 'Received', width: 90, minWidth: 80, hideBelow: RECEIVED_HIDE_BELOW_PX,
      render: i => <span className="whitespace-nowrap tabular-nums text-on-surf-v" title={fmtSastDateTime(i.received_at) ?? undefined}>{Number.isFinite(Date.parse(i.received_at)) ? `${fmtAge(i.received_at, now)} ago` : '—'}</span>,
    },
    { id: 'reference', label: 'Incident', width: 230, minWidth: 200, render: i => <RecordLink href={ROUTES.incidentDetail(i.incident_id)} className="!min-h-0 whitespace-nowrap tabular-nums">{i.trip_reference} · {i.reference}</RecordLink> },
    { id: 'type', label: 'Type', width: 100, minWidth: 80, render: i => <span className="block truncate" title={INCIDENT_TYPE_LABELS[i.incident_type]}>{INCIDENT_TYPE_LABELS[i.incident_type]}</span> },
    { id: 'status', label: 'Status', width: 120, minWidth: 100, skeleton: CHIP_SKELETON, render: i => <IncidentStatusChip status={i.status} /> },
  ]
}

/** The dashboard's Incidents panel: the newest incidents not yet closed, with how many are open in
 *  total. Closed incidents and the full list live on the Incidents page. */
export function DashboardIncidentsPanel(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useIncidents(ALL_INCIDENTS)
  const now = useNow(CLOCK_TICK_MS)
  const columns = useMemo(() => buildColumns(now), [now])
  const open = useMemo(() => openIncidents(data), [data])

  const initialLoad = isLoading && data.length === 0
  const loadFailed = !!error && data.length === 0
  const refreshFailed = !!error && data.length > 0
  const loadedAt = useLastLoadedAt(data)

  return (
    <DashboardPanel
      title="Incidents"
      count={initialLoad || loadFailed ? null : `${open.length} open`}
      noun="incidents"
      viewAllHref={ROUTES.incidents}
      help="incidents"
    >
      {refreshFailed && <RefreshFailedNote loadedAt={loadedAt} onRetry={refetch} />}
      {loadFailed ? (
        <EmptyState
          className="py-8"
          icon={<AlertCircle />}
          title="Failed to load incidents"
          body={error ?? ''}
          cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
        />
      ) : !initialLoad && open.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Ic n="check" s={32} />}
          title="No open incidents"
          body="Nothing is waiting on an investigation."
        />
      ) : (
        <Table<IncidentSummary>
          tableId={TABLE_ID}
          caption="Open incidents"
          isLoading={initialLoad}
          loadingLabel="Loading incidents"
          skeletonRows={SKELETON_ROWS}
          columns={columns}
          rows={open.slice(0, PANEL_ROW_LIMIT)}
          getRowKey={i => i.incident_id}
          density="compact"
          className="min-h-0 flex-1"
        />
      )}
    </DashboardPanel>
  )
}
