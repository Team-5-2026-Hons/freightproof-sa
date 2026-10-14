// All driver-pwa route strings and builders — never write URL literals in components.
// Phase step page URLs are built by lib/phase/routes.ts's phaseStepRoute instead, since
// that module needs phase-aware routing a flat string table can't express.
//
// The trip itself is never in the URL for these routes — the backend enforces one active
// trip per driver, so "which trip" comes from the driver's session (TripContext). This
// also keeps routes compatible with `output: 'export'`, which requires every dynamic
// segment to be enumerable at build time — a real trip's UUID never is.

const PANIC_SUBMITTED_PATH = '/trip/panic/submitted'

// Static route serving any real trip's detail; the id arrives as a query param (see
// ROUTES.tripDetailById).
const TRIP_DETAIL_PATH = '/trips/detail'

// Query param TripDetailByIdPageClient reads via useSearchParams(). Exported so the page
// and the route builder can never drift apart.
export const TRIP_ID_PARAM = 'id'

// Query param distinguishing a panic alert that reached the backend from one only
// queued on-device — see ROUTES.panicSubmittedUrl and PanicSubmittedPageClient.
export const PANIC_QUEUED_PARAM = 'queued'

export const ROUTES = {
  home:     '/',
  login:    '/login',
  settings: '/settings',
  trips:    '/trips',

  // Mock-only: pre-rendered by generateStaticParams from mock fixture ids, so it can
  // only resolve a mock UUID — see tripDetailById below for real trips.
  tripDetail: (tripId: string) => `/trips/${tripId}`,
  // Real trip detail. The id rides in a query param, not a path segment, since
  // output: 'export' must enumerate every dynamic segment at build time.
  tripDetailById: (tripId: string) => `${TRIP_DETAIL_PATH}?${TRIP_ID_PARAM}=${tripId}`,
  // The driver's one real active trip, sourced from TripContext.
  activeTripDetail: '/trips/active',

  inTransit:  '/trip/in-transit',
  checkpoint: '/trip/in-transit/checkpoint',
  upload:     '/trip/in-transit/upload',
  exception:  '/trip/in-transit/exception',

  panic:          '/trip/panic',
  panicSubmitted: PANIC_SUBMITTED_PATH,
  // Plain path means the alert actually sent; `queued=1` means it was stored on-device
  // instead, so PanicSubmittedPageClient can show honest copy.
  panicSubmittedUrl: (queued: boolean) =>
    queued ? `${PANIC_SUBMITTED_PATH}?${PANIC_QUEUED_PARAM}=1` : PANIC_SUBMITTED_PATH,

  devTokens: '/dev/tokens',
} as const
