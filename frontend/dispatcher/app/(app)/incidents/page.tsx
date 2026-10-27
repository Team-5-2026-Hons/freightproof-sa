'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { SecHead } from '@/components/ui/SecHead'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { Ic } from '@/components/ui/Ic'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { SearchField } from '@/components/ui/SearchField'
import { Spinner } from '@/components/ui/Spinner'
import { Table } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { buildIncidentColumns } from '@/components/incidents/incidentColumns'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { ROUTES } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { useIncidents } from '@/lib/hooks/useIncidents'
import { useNow } from '@/lib/hooks/useNow'
import { useTableSort } from '@/lib/hooks/useTableSort'
import { useUrlListState } from '@/lib/hooks/useUrlListState'
import { useToast } from '@/lib/hooks/useToast'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import {
  DEFAULT_INCIDENT_SORT, defaultIncidentSortDirection, filterIncidents, INCIDENT_SORT_KEYS, paginate, sortIncidents,
  type OwnerFilter,
} from '@/lib/incidents/incident-list'
import { INCIDENT_LIST_CODEC, type TypeFilter } from '@/lib/incidents/list-view-state'
import { readPreferences } from '@/lib/preferences'
import type { IncidentSummary, IncidentType } from '@/lib/types/incident'
import type { StatusView } from '@/lib/incidents/list-view-state'

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
const CLOCK_TICK_MS = 60_000

export default function IncidentsPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading incidents" className="flex flex-1 items-center justify-center"><Spinner size="lg" /></div>}>
      <IncidentsList />
    </Suspense>
  )
}

function IncidentsList(): React.JSX.Element {
  const { user } = useAuth()
  const { notify } = useToast()
  const now = useNow(CLOCK_TICK_MS)
  const { state: { status, type: incidentType, owner }, update, search, setSearch, href: listHref } = useUrlListState(INCIDENT_LIST_CODEC)
  const columns = useMemo(
    () => buildIncidentColumns(now, id => withReturnTo(ROUTES.incidentDetail(id), listHref)),
    [now, listHref],
  )
  const [page, setPage] = useState(FIRST_PAGE)
  const [pageSize] = useState(() => readPreferences().rowsPerPage)
  const { sort, tableSort, onSort } = useTableSort({ keys: INCIDENT_SORT_KEYS, firstDir: defaultIncidentSortDirection, initial: DEFAULT_INCIDENT_SORT })

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

  function startOver<V>(set: (value: V) => void): (value: V) => void {
    return value => { set(value); setPage(FIRST_PAGE) }
  }
  const changeStatus = startOver((value: StatusView) => update({ status: value }))
  const changeSearch = startOver(setSearch)
  const changeType = startOver((value: TypeFilter) => update({ type: value }))
  const changeOwner = startOver((value: OwnerFilter) => update({ owner: value }))
  const sortBy = (columnId: string): void => { onSort(columnId); setPage(FIRST_PAGE) }

  const hasActiveFilters = status !== 'all' || incidentType !== 'all' || owner !== 'anyone' || search.trim() !== ''
  const clearFilters = (): void => {
    update({ status: 'all', type: 'all', owner: 'anyone', q: '' }); setPage(FIRST_PAGE)
  }

  const initialLoad = isLoading && data.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Incidents"
        badge={<InfoPopover title="Incidents" ariaLabel="About incidents" question={REPORT_HINT} />}
      />
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
              columns={columns}
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
