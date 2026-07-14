// Bump together with package.json "version" — not read at build time to avoid
// bundling package.json into the client.
export const APP_VERSION = '0.1.0'

// Real values come from env (NEXT_PUBLIC_SUPPORT_*); the fallbacks are deliberately fake.
// Phone uses an invalid SA area code (00) and email uses the IANA-reserved .example
// TLD so the placeholder is obviously fake even in a rendered screenshot, not just in source.
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+27 00 000 0000'
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@TODO-REPLACE.example'
