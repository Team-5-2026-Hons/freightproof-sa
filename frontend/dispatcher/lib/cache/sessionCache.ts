'use client'

/**
 * Registry for module-scope client caches keyed to one signed-in dispatcher.
 *
 * Sign-out is a React state change, not a page load, so module-scope caches survive it and
 * could leak a driver's identity/phone (POPIA) to the next dispatcher on the same tab unless
 * explicitly cleared here.
 */

type ClearFn = () => void

const registered = new Set<ClearFn>()

/** Called at module scope by each cache. Returns an unregister for tests. */
export function registerSessionCache(clear: ClearFn): () => void {
  registered.add(clear)
  return () => { registered.delete(clear) }
}

/** Discard everything held for the previously signed-in identity. */
export function clearSessionCaches(): void {
  registered.forEach(clear => clear())
}
