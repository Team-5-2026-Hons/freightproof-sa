// The Content-Security-Policy for every portal page, built per request by middleware.ts.
//
// Outsiders open the portal from a link whose path is the share token, and the page holds
// a viewer grant for the evidence behind it, so an injected script would hold both. Scripts
// run only with this request's nonce; the page may call only our API and the public Hedera
// mirrors it already trusts (lib/verify.ts), and nothing may frame it.

export const NONCE_HEADER = 'x-nonce'

interface CspInput {
  nonce: string
  apiOrigin: string
  mirrorOrigins: readonly string[]
  tileSource: string
  isDev: boolean
}

export function buildCsp({ nonce, apiOrigin, mirrorOrigins, tileSource, isDev }: CspInput): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:', tileSource],
    'font-src': ["'self'"],
    'connect-src': ["'self'", apiOrigin, ...mirrorOrigins],
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

/**
 * The CSP source for a Leaflet tile URL template: its origin, with a `{s}` subdomain
 * placeholder widened to a wildcard (`https://{s}.tile.example` → `https://*.tile.example`).
 */
export function tileSourceFrom(template: string): string {
  const match = /^(https?:\/\/[^/]+)/.exec(template.replace('{s}', '*'))
  if (match === null) throw new Error(`Not an absolute tile URL template: ${template}`)
  return match[1]
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  return btoa(crypto.randomUUID())
}
