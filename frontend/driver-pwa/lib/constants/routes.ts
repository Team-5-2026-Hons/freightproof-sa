// All driver-pwa route strings and builders — never write URL literals in components.
// Step page URLs match spec §8.0: /trip/handshake/[h]/step/[n]-[slug]
//
// The trip itself is never in the URL for these routes — the backend enforces one
// active (non-terminal) trip per driver, so "which trip" always comes from the
// driver's session (TripContext), never from a URL param. This also keeps these
// routes compatible with `output: 'export'` (static export, required for the
// Capacitor APK), which requires every dynamic segment to be enumerable at build
// time — a real trip's UUID never is.

export const ROUTES = {
  home:     '/',
  login:    '/login',
  settings: '/settings',
  trips:    '/trips',

  // Mock-only generic trip detail, used by the still-mock Upcoming/Past tabs.
  tripDetail: (tripId: string) => `/trips/${tripId}`,
  // The driver's one real active trip, sourced from TripContext.
  activeTripDetail: '/trips/active',

  handshakeStep: (handshake: number, slug: string) => `/trip/handshake/${handshake}/step/${slug}`,

  inTransit:  '/trip/in-transit',
  checkpoint: '/trip/in-transit/checkpoint',
  upload:     '/trip/in-transit/upload',
  exception:  '/trip/in-transit/exception',

  panic:          '/trip/panic',
  panicSubmitted: '/trip/panic/submitted',

  devTokens: '/dev/tokens',
} as const
