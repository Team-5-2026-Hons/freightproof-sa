// Injected from package.json "version" at build time via next.config.ts `env`.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'

// No fallback number: Settings hides the call row until NEXT_PUBLIC_SUPPORT_PHONE is
// configured, so a demo can never show a fake number a driver might try to ring. (The
// old fallback was a deliberately invalid '+27 00 000 0000', which still read as real.)
// An empty string counts as unset.
export const SUPPORT_PHONE: string | null = process.env.NEXT_PUBLIC_SUPPORT_PHONE || null
// The email fallback is an address on the product's own domain, so it stays.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@freightproof.co.za'

// How often TripContext quietly re-asks for the trip while blocked on an external system
// (lib/hooks/useTripAutoRefresh.ts) — close enough to live without wasting battery/data.
export const TRIP_POLL_INTERVAL_MS = 15_000

// The same question asked by a driver who has no trip yet. Slower on purpose: a blocked
// gate clears in seconds and the driver is standing at it, whereas an assignment is
// minutes away and this poll runs for as long as the app is open on an empty Home.
export const UNASSIGNED_TRIP_POLL_INTERVAL_MS = 60_000
