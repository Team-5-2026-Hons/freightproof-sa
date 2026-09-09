'use client'

/**
 * Where a detail page should send the reader "back" to.
 *
 * A vehicle or precinct is reached from several places — its own list, a search, or a
 * trip that happens to use it. Hard-coding the list means the one route that matters most
 * (back to the trip you were reading) is the one it cannot do.
 *
 * Preferred over router.back() because history is not a reliable statement of intent: a
 * refresh, an in-page edit that pushes its own entry, or a link opened in a new tab all
 * leave back() pointing somewhere else or nowhere at all. A parameter survives all three.
 */

export const RETURN_TO_PARAM = 'returnTo'

// Any fixed origin serves: what matters is only whether the value STAYS on it, never
// which one it is. `.invalid` is reserved by RFC 2606, so it can never resolve anywhere.
const PROBE_ORIGIN = 'https://freightproof.invalid'

/**
 * Validate a return path before navigating to it.
 *
 * The value arrives in the address bar, so it is attacker-controllable: without this an
 * emailed link like ?returnTo=https://example.com turns the app's own Back button into an
 * open redirect.
 *
 * Resolved through the URL parser rather than matched as a prefix, because the parser is
 * what the router itself will ultimately apply — and it accepts forms no prefix check can
 * see. A leading-"//" test misses "/\evil.com", which the WHATWG parser normalises to
 * "//evil.com" and lands on another origin while still passing startsWith('/'); embedded
 * tabs and newlines ("/\t/evil.com") are stripped to the same effect.
 */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  // Still required alongside the origin check below: it is what rejects an absolute URL
  // outright, so this only ever honours a path, never a rewritten same-origin href.
  if (!value || !value.startsWith('/')) return fallback
  let resolved: URL
  try {
    resolved = new URL(value, PROBE_ORIGIN)
  } catch {
    return fallback
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback
  // The parser's own normalisation, never the raw input — the router must be handed
  // exactly the string that was validated, not one that can still be re-read differently.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

/** Append a return path to a destination, preserving any query it already carries. */
export function withReturnTo(target: string, returnTo: string | null | undefined): string {
  if (!returnTo) return target
  return `${target}${target.includes('?') ? '&' : '?'}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
}
