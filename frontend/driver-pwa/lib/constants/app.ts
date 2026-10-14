// Injected from package.json "version" at build time via next.config.ts `env`.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'

// Fallbacks are deliberately fake (invalid SA area code, IANA-reserved TLD) so a
// placeholder is obviously fake even in a rendered screenshot.
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+27 00 000 0000'
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@freightproof.co.za'

// How often TripContext quietly re-asks for the trip while blocked on an external system
// (lib/hooks/useTripAutoRefresh.ts) — close enough to live without wasting battery/data.
export const TRIP_POLL_INTERVAL_MS = 15_000
