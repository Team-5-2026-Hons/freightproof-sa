import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import type { UrlListCodec } from '@/lib/hooks/useUrlListState'
import type { IncidentStatus, IncidentType } from '@/lib/types/incident'
import type { OwnerFilter } from './incident-list'

export const INCIDENT_STATUS_VIEWS = ['all', 'open', 'investigating', 'closed'] as const
export type StatusView = IncidentStatus | 'all'
export type TypeFilter = IncidentType | 'all'
const OWNER_FILTERS: readonly OwnerFilter[] = ['anyone', 'mine', 'unassigned']

/** What the Incidents list keeps in its URL. Sort and page stay local: they are not what a
 *  dispatcher means by "the list as I left it", and a stale page number could land on nothing. */
export interface IncidentListView {
  status: StatusView
  type: TypeFilter
  owner: OwnerFilter
  q: string
}

const DEFAULTS = { status: 'all', type: 'all', owner: 'anyone' } as const satisfies Omit<IncidentListView, 'q'>

export function parseIncidentListView(params: URLSearchParams): IncidentListView {
  const type = params.get('type')
  return {
    status: INCIDENT_STATUS_VIEWS.find(status => status === params.get('status')) ?? DEFAULTS.status,
    type: Object.keys(INCIDENT_TYPE_LABELS).includes(type ?? '') ? type as IncidentType : DEFAULTS.type,
    owner: OWNER_FILTERS.find(owner => owner === params.get('owner')) ?? DEFAULTS.owner,
    q: params.get('q') ?? '',
  }
}

export function serializeIncidentListView(view: IncidentListView): string {
  const params = new URLSearchParams()
  if (view.status !== DEFAULTS.status) params.set('status', view.status)
  if (view.type !== DEFAULTS.type) params.set('type', view.type)
  if (view.owner !== DEFAULTS.owner) params.set('owner', view.owner)
  if (view.q) params.set('q', view.q)
  return params.toString()
}

export const INCIDENT_LIST_CODEC: UrlListCodec<IncidentListView> = { parse: parseIncidentListView, serialize: serializeIncidentListView }
