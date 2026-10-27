// All driver-pwa route strings and builders — never write URL literals in components.
// Phase step page URLs are built by lib/phase/routes.ts's phaseStepRoute instead, since
// that module needs phase-aware routing a flat string table can't express.
//
// The trip itself is never in the URL for these routes — the backend enforces one active
// trip per driver, so "which trip" comes from the driver's session (TripContext). This
// also keeps routes compatible with `output: 'export'`, which requires every dynamic
// segment to be enumerable at build time — a real trip's UUID never is.

const PANIC_SUBMITTED_PATH = '/trip/panic/submitted'

const TRIP_DETAIL_PATH = '/trips/detail'

export const TRIP_ID_PARAM = 'id'

export const SUBSTITUTION_PATH = '/trips/substitution'
export const SUBSTITUTION_TRIP_PARAM = 'trip'
export const SUBSTITUTION_REQUEST_PARAM = 'request'

export const PANIC_QUEUED_PARAM = 'queued'
export const PANIC_AT_PARAM = 'at'
export const PANIC_LOCATED_PARAM = 'loc'

export interface PanicReceipt {
  at: string
  located: boolean
}

export const ROUTES = {
  home:     '/',
  login:      '/login',
  loginPhone: '/login/phone',
  profile:  '/profile',
  settings: '/settings',
  trips:    '/trips',
  tripsPast:     '/trips/past',
  tripsUpcoming: '/trips/upcoming',

  tripDetail: (tripId: string) => `/trips/${tripId}`,
  tripDetailById: (tripId: string) => `${TRIP_DETAIL_PATH}?${TRIP_ID_PARAM}=${tripId}`,
  activeTripDetail: '/trips/active',
  substitution: (tripId: string, requestId: string) => {
    const params = new URLSearchParams({ [SUBSTITUTION_TRIP_PARAM]: tripId, [SUBSTITUTION_REQUEST_PARAM]: requestId })
    return `${SUBSTITUTION_PATH}?${params.toString()}`
  },
  retainedEvidence: '/evidence',

  inTransit:  '/trip/in-transit',
  checkpoint: '/trip/in-transit/checkpoint',
  upload:     '/trip/in-transit/upload',
  exception:  '/trip/in-transit/exception',

  panic:          '/trip/panic',
  panicSubmitted: PANIC_SUBMITTED_PATH,
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
