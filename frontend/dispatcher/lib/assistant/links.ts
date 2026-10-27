// Where an assistant button goes (assistant spec D2, D2c). Built only from ROUTES and the few filters each page
// already reads from its address; anything else a server reply carried is dropped. Pure: no React.

import { ROUTES } from '@/lib/constants/routes'
import { addFormHref } from '@/lib/fleet/add-form-href'
import { buildPrefillHref } from '@/lib/trips/prefill'
import type { AssistantAction, OpenPageAction } from '@shared/lib/types/assistant'

export const ANALYTICS_ASK_PARAM = 'ask'

const PAGE_FILTERS: Partial<Record<OpenPageAction['page'], readonly string[]>> = {
  exceptions: ['severity', 'q'],
  parcels: ['barcode', 'waybill'],
  analytics: [ANALYTICS_ASK_PARAM],
}

function withFilters(path: string, action: OpenPageAction): string {
  const allowed = PAGE_FILTERS[action.page] ?? []
  const query = new URLSearchParams()
  for (const key of allowed) {
    const value = action.filters[key]
    if (value) query.set(key, value)
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

function pagePath(action: OpenPageAction): string {
  const id = action.record_id
  switch (action.page) {
    case 'dashboard': return ROUTES.home
    case 'trip': return id ? ROUTES.tripDetail(id) : ROUTES.home
    case 'history': return ROUTES.history
    case 'exceptions': return ROUTES.exceptions
    case 'incidents': return ROUTES.incidents
    case 'drivers': return ROUTES.fleetDrivers
    case 'driver': return id ? ROUTES.fleetDriverDetail(id) : ROUTES.fleetDrivers
    case 'vehicles': return ROUTES.fleetVehicles
    case 'vehicle': return id ? ROUTES.fleetVehicleDetail(id) : ROUTES.fleetVehicles
    case 'precincts': return ROUTES.precincts
    case 'precinct': return id ? ROUTES.precinctDetail(id) : ROUTES.precincts
    case 'parcels': return ROUTES.parcels
    case 'analytics': return ROUTES.analytics
    case 'add_precinct': return ROUTES.precinctNew
    case 'add_driver': return addFormHref(ROUTES.fleetDrivers)
    case 'add_vehicle': return addFormHref(ROUTES.fleetVehicles)
  }
}

export function hrefForAction(action: AssistantAction): string {
  if (action.kind === 'open_trip_form') return buildPrefillHref(action.params)
  return withFilters(pagePath(action), action)
}
