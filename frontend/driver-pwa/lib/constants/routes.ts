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

// Handover check. Static path with query-string ids for the same static-export reason
// as trip detail; both params are read by SubstitutionPageClient.
export const SUBSTITUTION_PATH = '/trips/substitution'
export const SUBSTITUTION_TRIP_PARAM = 'trip'
export const SUBSTITUTION_REQUEST_PARAM = 'request'

// Query param distinguishing a panic alert that reached the backend from one only
// queued on-device — see ROUTES.panicSubmittedUrl and PanicSubmittedPageClient.
export const PANIC_QUEUED_PARAM = 'queued'
// When the driver swiped (ISO) and whether a phone fix went with the alert, so the
// sent/saved screen states facts about THIS alert (7.2/7.3), not about the page load.
export const PANIC_AT_PARAM = 'at'
export const PANIC_LOCATED_PARAM = 'loc'

export interface PanicReceipt {
  /** When the driver confirmed the alert (ISO). */
  at: string
  /** Whether the driver's position travelled with it. */
  located: boolean
}

export const ROUTES = {
  home:     '/',
  // Welcome screen; the phone entry it leads to sits under it so the '/login' auth-route
  // prefix (AuthContext, (app)/layout, OTP page) covers both without a new entry.
  login:      '/login',
  loginPhone: '/login/phone',
  // Profile merged Settings in (Oct 2026). /settings stays only as a redirect to it, so
  // a bookmark or an old in-app link still lands somewhere real.
  profile:  '/profile',
  settings: '/settings',
  trips:    '/trips',
  // "See all" from the Trips tab, which itself never scrolls. Static
  // segments, so they outrank /trips/[id] under output: 'export'.
  tripsPast:     '/trips/past',
  tripsUpcoming: '/trips/upcoming',

  // Mock-only: pre-rendered by generateStaticParams from mock fixture ids, so it can
  // only resolve a mock UUID — see tripDetailById below for real trips.
  tripDetail: (tripId: string) => `/trips/${tripId}`,
  // Real trip detail. The id rides in a query param, not a path segment, since
  // output: 'export' must enumerate every dynamic segment at build time.
  tripDetailById: (tripId: string) => `${TRIP_DETAIL_PATH}?${TRIP_ID_PARAM}=${tripId}`,
  // The driver's one real active trip, sourced from TripContext.
  activeTripDetail: '/trips/active',
  // This driver's own handover/takeover check for one arrangement.
  substitution: (tripId: string, requestId: string) => {
    const params = new URLSearchParams({ [SUBSTITUTION_TRIP_PARAM]: tripId, [SUBSTITUTION_REQUEST_PARAM]: requestId })
    return `${SUBSTITUTION_PATH}?${params.toString()}`
  },
  // Captures kept on this phone for the driver's decision (refused, quarantined).
  retainedEvidence: '/evidence',

  inTransit:  '/trip/in-transit',
  checkpoint: '/trip/in-transit/checkpoint',
  upload:     '/trip/in-transit/upload',
  exception:  '/trip/in-transit/exception',

  panic:          '/trip/panic',
  panicSubmitted: PANIC_SUBMITTED_PATH,
  // No `queued` means the alert actually sent; `queued=1` means it was stored on-device
  // instead, so PanicSubmittedPageClient can show honest copy.
  panicSubmittedUrl: (queued: boolean, receipt?: PanicReceipt) => {
    const params = new URLSearchParams()
    if (queued) params.set(PANIC_QUEUED_PARAM, '1')
    if (receipt !== undefined) {
      params.set(PANIC_AT_PARAM, receipt.at)
      params.set(PANIC_LOCATED_PARAM, receipt.located ? '1' : '0')
    }
    const query = params.toString()
    return query === '' ? PANIC_SUBMITTED_PATH : `${PANIC_SUBMITTED_PATH}?${query}`
  },
} as const
