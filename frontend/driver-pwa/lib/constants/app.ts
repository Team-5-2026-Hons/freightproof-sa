// Injected from package.json "version" at build time via next.config.ts `env` —
// the fallback only appears in unbuilt contexts (unit tests).
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'

// Real values come from env (NEXT_PUBLIC_SUPPORT_*); the fallbacks are deliberately fake.
// Phone uses an invalid SA area code (00) and email uses the IANA-reserved .example
// TLD so the placeholder is obviously fake even in a rendered screenshot, not just in source.
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+27 00 000 0000'
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@freightproof.co.za'

// How often TripContext quietly re-asks for the trip while blocked on an external system
// (warehouse scan, exception hold) — see lib/hooks/useTripAutoRefresh.ts. 15s reads as
// close enough to live for a driver watching "Waiting for the warehouse" clear on its own,
// without polling often enough to matter for battery or a driver's mobile data.
export const TRIP_POLL_INTERVAL_MS = 15_000
