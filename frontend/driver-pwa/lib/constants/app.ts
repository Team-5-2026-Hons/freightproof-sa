// Injected from package.json "version" at build time via next.config.ts `env` —
// the fallback only appears in unbuilt contexts (unit tests).
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'

// Real values come from env (NEXT_PUBLIC_SUPPORT_*); the fallbacks are deliberately fake.
// Phone uses an invalid SA area code (00) and email uses the IANA-reserved .example
// TLD so the placeholder is obviously fake even in a rendered screenshot, not just in source.
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+27 00 000 0000'
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@freightproof.co.za'
