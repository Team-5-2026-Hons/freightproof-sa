// All dispatcher route strings in one place — never write URL literals in components.
// See spec §7 for the full page catalogue.

export const ROUTES = {
  home:            '/',
  trips:           '/trips',
  tripDetail:      (id: string) => `/trips/${id}`,
  tripNew:         '/trips/new',
  history:         '/history',
  exceptions:      '/exceptions',
  exceptionDetail: (id: string) => `/exceptions/${id}`,
  sla:             '/sla',
  fleetVehicles:   '/fleet/vehicles',
  fleetDrivers:    '/fleet/drivers',
  precincts:       '/precincts',
  precinctDetail:  (id: string) => `/precincts/${id}`,
  precinctNew:     '/precincts/new',
  precinctEdit:    (id: string) => `/precincts/${id}/edit`,
  settings:        '/settings',
  login:           '/login',
  devTokens:       '/dev/tokens',
} as const
