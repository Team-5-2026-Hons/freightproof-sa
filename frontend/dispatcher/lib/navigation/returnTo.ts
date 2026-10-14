'use client'

/**
 * Where a detail page should send the reader "back" to, via a query param rather than
 * router.back() — history isn't reliable across a refresh, an in-page pushState, or a new tab.
 */

export const RETURN_TO_PARAM = 'returnTo'

// Any fixed origin works; `.invalid` is RFC 2606-reserved so it never resolves for real.
const PROBE_ORIGIN = 'https://freightproof.invalid'

/**
 * Validate a return path before navigating to it — an attacker-controlled value (e.g. an
 * emailed ?returnTo=https://evil.com) would otherwise turn Back into an open redirect.
 * Resolved through the URL parser, not a prefix match: the parser normalises forms
 * (e.g. "/\evil.com" → "//evil.com") that a prefix check would miss.
 */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/')) return fallback
  try {
    const resolved = new URL(value, PROBE_ORIGIN)
    if (resolved.origin !== PROBE_ORIGIN) return fallback

    // Use the parser's normalised path, not the raw input, so it matches what was validated.
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`

    // Re-check the normalised output: traversal (e.g. "/a/..//evil.com") can produce a
    // protocol-relative path that passed the input check but leaves the origin.
    if (new URL(path, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return fallback
    return path
  } catch {
    return fallback
  }
}

/** Append a return path to a destination, preserving any query it already carries. */
export function withReturnTo(target: string, returnTo: string | null | undefined): string {
  if (!returnTo) return target
  return `${target}${target.includes('?') ? '&' : '?'}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
}
