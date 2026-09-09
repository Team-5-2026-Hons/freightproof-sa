'use client'

/**
 * Client caches that belong to ONE signed-in dispatcher.
 *
 * The trip caches live at module scope so every reader of a URL shares one record and one
 * request. Module scope outlives a sign-out, though: signing out is a React state change,
 * not a page load, so nothing in the browser discards what was cached — and a second
 * dispatcher signing in on the same tab could be shown the first one's trip, manifest and
 * evidence links off that cache before any request went out. The server would refuse the
 * revalidation, but the resource layer deliberately keeps the last successful response
 * behind an error, so the refusal would leave the record on screen rather than remove it.
 *
 * That data is not incidental: a trip record carries the driver's identity and phone
 * number, which under POPIA is exactly what must not outlive the session that was
 * entitled to read it.
 *
 * A registry rather than direct calls, so that auth does not have to import the trip
 * feature to be able to forget it — and so the next cache added is one line here instead
 * of a new import in AuthContext. Registration happens when a cache module is first
 * imported, which is also the first moment it could hold anything.
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
