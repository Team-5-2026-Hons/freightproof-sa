// Precinct: a physical depot or warehouse with a GPS geofence boundary.
// Organization: the client organisation that owns a precinct (e.g. FedEx, Courier Guy).
// Mirrors backend PrecinctRead and OrganizationRead schemas in schemas/organisations.py.

import type { BlockchainReceipt, PrecinctEvent } from './blockchain'

export type PrecinctId = string & { readonly __brand: 'PrecinctId' }
export type OrganizationId = string & { readonly __brand: 'OrganizationId' }

export type OrganizationType = 'operator' | 'principal' | 'both'

export interface Organization {
  id: OrganizationId
  name: string
  org_type: OrganizationType
  contact_email: string | null
  created_at: string
}

/** One outline corner, [lat, lng] — lat-first like every other coordinate here. */
export type LatLngPair = [number, number]

export interface Precinct {
  id: PrecinctId
  name: string
  principal_organization_id: OrganizationId
  address: string | null
  latitude: number
  longitude: number
  geofence_radius_metres: number
  geofence_polygon?: LatLngPair[] | null
  is_shared: boolean
  created_at: string
}

export interface PrecinctDetail extends Precinct {
  events: PrecinctEvent[]
  receipts: BlockchainReceipt[]
}
