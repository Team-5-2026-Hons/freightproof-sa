// Precinct: a physical depot or warehouse with a GPS geofence boundary.
// Principal: the client organisation that owns a precinct (e.g. FedEx, Courier Guy).
// Mirrors backend PrecinctRead and OrganizationRead schemas in schemas/organisations.py.

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

export interface Precinct {
  id: PrecinctId
  name: string
  principal_organization_id: OrganizationId
  address: string | null
  latitude: number
  longitude: number
  geofence_radius_metres: number
  created_at: string
}
