'use client'

import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { Table, type TableColumn } from '@/components/ui/Table'
import { IncidentStatusChip } from '@/components/incidents/IncidentStatusChip'
import { useAuth } from '@/lib/hooks/useAuth'
import { useIncidents } from '@/lib/hooks/useIncidents'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import type { IncidentStatus, IncidentSummary, IncidentType } from '@/lib/types/incident'
import { cn } from '@shared/lib/utils/cn'

type StatusFilter = IncidentStatus | 'all'

// All first, and the default: closing an incident must not make it vanish from the list
// the dispatcher is looking at. Its chip says Closed instead.
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'closed', label: 'Closed' },
]

const COLUMNS: readonly TableColumn<IncidentSummary>[] = [
  { id: 'reference', label: 'Incident', width: 170, render: i => <RecordLink href={ROUTES.incidentDetail(i.incident_id)} className="tabular-nums">{i.trip_reference} · {i.reference}</RecordLink> },
  { id: 'type', label: 'Type', width: 130, render: i => INCIDENT_TYPE_LABELS[i.incident_type] },
  { id: 'status', label: 'Status', width: 140, render: i => <IncidentStatusChip status={i.status} /> },
  { id: 'summary', label: 'What was reported', width: 320, render: i => <span className="line-clamp-2">{i.summary}</span> },
  { id: 'cargo', label: 'Unresolved', width: 110, hideBelow: 900, render: i => i.parcels_total === 0 ? '—' : `${i.parcels_unresolved} of ${i.parcels_total}` },
  { id: 'owner', label: 'Investigated by', width: 150, hideBelow: 1000, render: i => i.assigned_to_name ?? 'Unassigned' },
  { id: 'received', label: 'Received', width: 150, hideBelow: 1100, render: i => <span className="tabular-nums">{fmtSastDateTime(i.received_at) ?? '—'}</span> },
]

export default function IncidentsPage(): React.JSX.Element {
  const { user } = useAuth()
  const { notify } = useToast()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [incidentType, setIncidentType] = useState<IncidentType | 'all'>('all')
  const [mine, setMine] = useState(false)
  const { data, isLoading, error, refetch } = useIncidents({
    status: status === 'all' ? undefined : status,
    incident_type: incidentType === 'all' ? undefined : incidentType,
    assigned_to: mine && user ? user.id : undefined,
  })

  useEffect(() => {
    if (error) notify({ kind: 'error', title: 'Failed to load incidents', body: error })
  }, [error, notify])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Incidents" />
      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-[2px] rounded-md bg-surf-low p-[3px]" role="group" aria-label="Status">
            {STATUS_FILTERS.map(f => (
              <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}
                className={cn('rounded-[4px] px-[10px] py-[5px] text-[10px] font-[700] uppercase tracking-[0.06em] transition-colors',
                  status === f.id ? 'bg-surf-lowest text-on-surf shadow-level-1' : 'text-on-surf-v hover:text-on-surf')}>
                {f.label}
              </button>
            ))}
          </div>
          <select aria-label="Incident type" value={incidentType} onChange={e => setIncidentType(e.target.value as IncidentType | 'all')}
            className="rounded-md border border-outline-v/30 bg-surf-low px-3 py-2 text-[13px] text-on-surf">
            <option value="all">All types</option>
            {(Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map(t => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[13px] text-on-surf">
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine only
          </label>
        </div>
        <p className="text-xs text-on-surf-v">Report an incident from a trip&apos;s Info tab, or from an exception.</p>

        {error && data.length === 0 ? (
          <EmptyState icon={<AlertCircle />} title="Failed to load" body={error}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>} />
        ) : !isLoading && data.length === 0 ? (
          <EmptyState icon={<Ic n="warn" s={32} />} title="No incidents" body="Nothing matches these filters." />
        ) : (
          <Table tableId="incidents" caption="Incidents" columns={COLUMNS} rows={data} getRowKey={i => i.incident_id}
            isLoading={isLoading && data.length === 0} loadingLabel="Loading incidents" density="compact" />
        )}
      </div>
    </div>
  )
}
