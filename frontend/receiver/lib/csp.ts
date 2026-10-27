// The Content-Security-Policy for every receiver page, built per request by middleware.ts.
//
// The page is opened by strangers from a QR link whose path is a live capability token, so
// an injected script would hold that token and the receiver's signature. Scripts run only
// with this request's nonce; nothing may frame the page (a clickjacked swipe would be a
// signature the receiver never meant to give).

export const NONCE_HEADER = 'x-nonce'

interface CspInput {
  nonce: string
  apiOrigin: string
  isDev: boolean
}

export function buildCsp({ nonce, apiOrigin, isDev }: CspInput): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", apiOrigin],
    'object-src': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
  }
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ')
}

/** The origin of the API URL the bundle was built with; the dev fallback when unset. */
export function apiOriginFrom(apiUrl: string | undefined, devFallback: string): string {
  return new URL(apiUrl || devFallback).origin
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  return btoa(crypto.randomUUID())
}
