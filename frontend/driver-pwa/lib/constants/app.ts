// Injected from package.json "version" at build time via next.config.ts `env`.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'

export const SUPPORT_PHONE: string | null = process.env.NEXT_PUBLIC_SUPPORT_PHONE || null
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@freightproof.co.za'

export const TRIP_POLL_INTERVAL_MS = 15_000

export const UNASSIGNED_TRIP_POLL_INTERVAL_MS = 10_000
