// Media-query reads for code that runs outside React's render (Leaflet setup, scroll handlers).

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether a media query currently matches. False where matchMedia does not exist (jsdom, very
 * old WebViews), so callers fall back to the plain desktop behaviour instead of throwing.
 */
export function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

export function prefersReducedMotion(): boolean {
  return mediaMatches(REDUCED_MOTION_QUERY)
}
