'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { TopBar } from '@/components/ui/TopBar'
import { SecHead } from '@/components/ui/SecHead'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { Ic } from '@/components/ui/Ic'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { RecordLink } from '@/components/ui/RecordLink'
import { SearchField } from '@/components/ui/SearchField'
import { Table, type TableColumn } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { IncidentStatusChip } from '@/components/incidents/IncidentStatusChip'
import { useAuth } from '@/lib/hooks/useAuth'
import { useIncidents } from '@/lib/hooks/useIncidents'
import { useTableSort } from '@/lib/hooks/useTableSort'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import {
  DEFAULT_INCIDENT_SORT, defaultIncidentSortDirection, filterIncidents, INCIDENT_SORT_KEYS, paginate, sortIncidents,
  type OwnerFilter,
} from '@/lib/incidents/incident-list'
import { readPreferences } from '@/lib/preferences'
import type { IncidentStatus, IncidentSummary, IncidentType } from '@/lib/types/incident'

type StatusView = IncidentStatus | 'all'
type TypeFilter = IncidentType | 'all'

// All first, and the default: closing an incident must not make it vanish from the list
// the dispatcher is looking at. Its chip says Closed instead.
const STATUS_TABS: readonly { id: StatusView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'closed', label: 'Closed' },
]

const TYPE_OPTIONS = [
  { value: 'all' as const, label: 'All types' },
  ...(Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map(value => ({ value, label: INCIDENT_TYPE_LABELS[value] })),
]

const OWNER_OPTIONS = [
  { value: 'anyone' as const, label: 'Anyone' },
  { value: 'mine' as const, label: 'Assigned to me' },
  { value: 'unassigned' as const, label: 'Unassigned' },
]

const INCIDENT_TABLE_ID = 'incidents'
const REPORT_HINT = "Report an incident from a trip's Info tab, or from an exception."
const FIRST_PAGE = 1

const COLUMNS: readonly TableColumn<IncidentSummary>[] = [
  { id: 'reference', label: 'Incident', width: 170, sortable: true, render: i => <RecordLink href={ROUTES.incidentDetail(i.incident_id)} className="tabular-nums">{i.trip_reference} · {i.reference}</RecordLink> },
  { id: 'type', label: 'Type', width: 130, sortable: true, render: i => INCIDENT_TYPE_LABELS[i.incident_type] },
  { id: 'status', label: 'Status', width: 140, sortable: true, render: i => <IncidentStatusChip status={i.status} /> },
  { id: 'summary', label: 'What was reported', width: 320, render: i => <span className="line-clamp-2">{i.summary}</span> },
  { id: 'cargo', label: 'Unresolved', width: 110, hideBelow: 900, sortable: true, render: i => i.parcels_total === 0 ? '—' : `${i.parcels_unresolved} of ${i.parcels_total}` },
  { id: 'owner', label: 'Investigated by', width: 150, hideBelow: 1000, sortable: true, render: i => i.assigned_to_name ?? 'Unassigned' },
  { id: 'received', label: 'Received', width: 150, hideBelow: 1100, sortable: true, render: i => <span className="tabular-nums">{fmtSastDateTime(i.received_at) ?? '—'}</span> },
]

export default function IncidentsPage(): React.JSX.Element {
  const { user } = useAuth()
  const { notify } = useToast()
  const [status, setStatus] = useState<StatusView>('all')
  const [incidentType, setIncidentType] = useState<TypeFilter>('all')
  const [owner, setOwner] = useState<OwnerFilter>('anyone')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(FIRST_PAGE)
  // Read once per mount, as Trip History does: a changed preference applies on the next visit.
  const [pageSize] = useState(() => readPreferences().rowsPerPage)
  const { sort, tableSort, onSort } = useTableSort({ keys: INCIDENT_SORT_KEYS, firstDir: defaultIncidentSortDirection, initial: DEFAULT_INCIDENT_SORT })

  // Status, type and "assigned to me" are narrowed by the server; search and "unassigned" are not.
  const { data, isLoading, error, refetch } = useIncidents({
    status: status === 'all' ? undefined : status,
    incident_type: incidentType === 'all' ? undefined : incidentType,
    assigned_to: owner === 'mine' && user ? user.id : undefined,
  })

  useEffect(() => {
    if (error) notify({ kind: 'error', title: 'Failed to load incidents', body: error })
  }, [error, notify])

  const visible = useMemo(() => sortIncidents(filterIncidents(data, { search, owner }), sort), [data, search, owner, sort])
  const slice = useMemo(() => paginate(visible, page, pageSize), [visible, page, pageSize])

  // Every control that changes which rows there are, or their order, starts again at page one.
  function startOver<V>(set: (value: V) => void): (value: V) => void {
    return value => { set(value); setPage(FIRST_PAGE) }
  }
  const changeStatus = startOver(setStatus)
  const changeSearch = startOver(setSearch)
  const changeType = startOver(setIncidentType)
  const changeOwner = startOver(setOwner)
  const sortBy = (columnId: string): void => { onSort(columnId); setPage(FIRST_PAGE) }

  const hasActiveFilters = status !== 'all' || incidentType !== 'all' || owner !== 'anyone' || search.trim() !== ''
  const clearFilters = (): void => {
    setStatus('all'); setIncidentType('all'); setOwner('anyone'); setSearch(''); setPage(FIRST_PAGE)
  }

  const initialLoad = isLoading && data.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Incidents" />
      <div className="px-6 pt-4">
        <Tabs
          tabs={STATUS_TABS}
          active={status}
          onChange={id => changeStatus(id as StatusView)}
          panelId="incident-results"
          ariaLabel="Incident status"
          className="w-fit [&>button]:flex-none"
        />
      </div>
      <ListToolbar hasActiveFilters={hasActiveFilters} onClear={clearFilters}>
        <SearchField
          value={search}
          onChange={changeSearch}
          placeholder="Search trip reference, incident or summary…"
          ariaLabel="Search incidents"
        />
        <FilterSelect value={incidentType} onChange={changeType} options={TYPE_OPTIONS} ariaLabel="Incident type" />
        <FilterSelect value={owner} onChange={changeOwner} options={OWNER_OPTIONS} ariaLabel="Investigated by" />
      </ListToolbar>
      {/* Muted, not the TopBar's `sub`: that is link blue, and this is a hint rather than a link. */}
      <p className="-mt-1 px-6 pb-3 text-xs text-on-surf-v">{REPORT_HINT}</p>

      <div
        id="incident-results"
        role="tabpanel"
        aria-labelledby={`tab-${status}`}
        className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surf-lowest shadow-level-3"
      >
        <SecHead
          title="Incidents"
          meta={!initialLoad && !error && (
            <span aria-live="polite" className="text-[11px] font-semibold text-on-surf-v">{slice.totalItems} {slice.totalItems === 1 ? 'incident' : 'incidents'}</span>
          )}
        />
        {error && data.length === 0 ? (
          <EmptyState icon={<AlertCircle />} title="Failed to load" body={error}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>} />
        ) : !initialLoad && visible.length === 0 ? (
          hasActiveFilters
            ? <EmptyState icon={<Ic n="warn" s={32} />} title="Nothing matches these filters" body="Try a different search, or clear the filters."
                cta={<Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>} />
            : <EmptyState icon={<Ic n="warn" s={32} />} title="No incidents yet" body={REPORT_HINT} />
        ) : (
          <>
            <Table<IncidentSummary>
              tableId={INCIDENT_TABLE_ID}
              caption="Incidents"
              columns={COLUMNS}
              rows={slice.rows}
              getRowKey={i => i.incident_id}
              isLoading={initialLoad}
              loadingLabel="Loading incidents"
              density="compact"
              sort={tableSort}
              onSort={sortBy}
              className="min-h-0 flex-1"
            />
            {!initialLoad && (
              <div className="shrink-0 border-t border-outline-v/10 px-5 py-2">
                <Pagination
                  page={slice.page}
                  pageSize={pageSize}
                  itemCount={slice.rows.length}
                  totalItems={slice.totalItems}
                  hasPrevious={slice.hasPrevious}
                  hasNext={slice.hasNext}
                  onPrevious={() => setPage(slice.page - 1)}
                  onNext={() => setPage(slice.page + 1)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
