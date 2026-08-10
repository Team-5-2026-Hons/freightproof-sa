// All driver-pwa route strings and builders — never write URL literals in components.
// Phase step page URLs are built by lib/phase/routes.ts's phaseStepRoute(phaseType,
// slug) -> /trip/phase/[type]/step/[slug], not from an entry here — that module already
// owns the one place a step URL is built (its own header comment explains why phase
// steps need phase-aware routing, e.g. nextStepRoute, that a flat string table can't
// express). ROUTES stays the source of truth for every OTHER route, and for the
// reasoning below, which still applies unchanged to the phase step route too.
//
// The trip itself is never in the URL for these routes — the backend enforces one
// active (non-terminal) trip per driver, so "which trip" always comes from the
// driver's session (TripContext), never from a URL param. This also keeps these
// routes compatible with `output: 'export'` (static export, required for the
// Capacitor APK), which requires every dynamic segment to be enumerable at build
// time — a real trip's UUID never is. lib/phase/routes.ts's header note explains the
// same constraint for why the phase step route keys on phase_type rather than the
// (server-generated, never statically enumerable) phase_event_id.

const PANIC_SUBMITTED_PATH = '/trip/panic/submitted'

// Static route serving any real trip's detail; the trip id arrives as a query param
// (see ROUTES.tripDetailById for why it cannot be a path segment under output: 'export').
const TRIP_DETAIL_PATH = '/trips/detail'

// Query param TripDetailByIdPageClient reads via useSearchParams() to know which trip
// to fetch. Exported so the page and the route builder can never drift apart.
export const TRIP_ID_PARAM = 'id'

// Query param panic/submitted reads via useSearchParams() to tell a panic alert that
// actually reached the backend apart from one only queued on-device (no signal at
// submit time) — see ROUTES.panicSubmittedUrl and PanicSubmittedPageClient.
export const PANIC_QUEUED_PARAM = 'queued'

export const ROUTES = {
  home:     '/',
  login:    '/login',
  settings: '/settings',
  trips:    '/trips',

  // Mock-only generic trip detail. Kept for demo mode: its [id] segment is
  // pre-rendered by generateStaticParams from the mock fixture ids, so it can only ever
  // resolve a mock UUID — see tripDetailById below for real trips.
  tripDetail: (tripId: string) => `/trips/${tripId}`,
  // Real trip detail, addressed by id. The id rides in a QUERY PARAM, not a path
  // segment, because output: 'export' (Capacitor APK) must enumerate every dynamic
  // segment at build time and a real trip's UUID never is — which is exactly why
  // linking an Upcoming trip to tripDetail() above would 404 in the exported build.
  // Query params need no build-time enumeration, so one static route serves every trip.
  tripDetailById: (tripId: string) => `${TRIP_DETAIL_PATH}?${TRIP_ID_PARAM}=${tripId}`,
  // The driver's one real active trip, sourced from TripContext.
  activeTripDetail: '/trips/active',

  inTransit:  '/trip/in-transit',
  checkpoint: '/trip/in-transit/checkpoint',
  upload:     '/trip/in-transit/upload',
  exception:  '/trip/in-transit/exception',

  panic:          '/trip/panic',
  panicSubmitted: PANIC_SUBMITTED_PATH,
  // The plain path (no query) means the alert actually sent — matches the previous
  // unconditional navigation. `queued=1` means it couldn't reach the backend and was
  // stored on-device instead, so PanicSubmittedPageClient can show honest copy rather
  // than always claiming the dispatcher was notified.
  panicSubmittedUrl: (queued: boolean) =>
    queued ? `${PANIC_SUBMITTED_PATH}?${PANIC_QUEUED_PARAM}=1` : PANIC_SUBMITTED_PATH,

  devTokens: '/dev/tokens',
} as const
