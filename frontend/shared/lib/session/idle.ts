// Pure, dependency-free logic for the inactivity timeout both apps enforce.
//
// The rule: SESSION_IDLE_TIMEOUT_MS after the last sign of activity from this machine,
// the user is signed out. The backend enforces the same window independently
// (backend/app/auth/sessions.py) — this half exists so the user is actually signed out
// and told why, rather than finding out via a 401 on whatever they clicked next.
//
// Framework-agnostic on purpose, matching the rest of @shared/*: no React, no Next, no
// browser globals captured at module scope. The storage handle is passed in so this can
// be tested against a plain object, and so a caller in a non-browser context (the PWA's
// static-export prerender) can simply not call it.

/**
 * How long a session may sit idle before it ends.
 *
 * Must stay in step with SESSION_IDLE_TIMEOUT_MINUTES in backend/app/core/config.py.
 * They are enforced independently and neither reads the other, so a change to one is a
 * change to both. Kept marginally SHORTER than the server's window on purpose: whichever
 * side fires first decides the experience, and the client firing first produces a clean
 * "signed out for inactivity" screen, whereas the server firing first produces a failed
 * request the UI has to explain after the fact.
 */
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000

/** Grace subtracted from the server's window so the client is always the one to fire. */
const CLIENT_LEAD_MS = 15 * 1000

/** The effective client-side deadline. */
export const CLIENT_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MS - CLIENT_LEAD_MS

/**
 * Storage key holding the last-activity timestamp, in ms since epoch.
 *
 * localStorage, not sessionStorage, and that choice is the security-relevant one. The
 * timestamp has to outlive the tab: with sessionStorage, closing the browser and
 * reopening it hours later would present no timestamp at all, and a session that should
 * have expired would be treated as fresh. localStorage also gives cross-tab sync for
 * free — activity in any tab is activity for the machine, and a `storage` event tells
 * every other tab about it.
 */
export const LAST_ACTIVITY_KEY = 'fp:last-activity'

/** The minimum a subset of Storage this module needs. Lets tests pass a plain stub. */
export interface ActivityStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Record `now` as the moment of last activity. */
export function recordActivity(store: ActivityStore, now: number = Date.now()): void {
  try {
    store.setItem(LAST_ACTIVITY_KEY, String(now))
  } catch {
    // Storage can throw: Safari private browsing, or a full quota. An unwritable
    // timestamp must not break the app — the in-memory timer still runs for this tab,
    // and the backend's own idle check is unaffected either way. Deliberately silent:
    // this fires on every mousemove-ish event, so logging would flood the console.
  }
}

/** Forget the stored timestamp. Called on sign-out so the next session starts clean. */
export function clearActivity(store: ActivityStore): void {
  try {
    store.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    // Same rationale as recordActivity. A stale timestamp left behind is harmless: it
    // can only ever make the next session expire EARLIER, never later.
  }
}

/**
 * The stored last-activity time, or null when there is none or it is unreadable.
 *
 * A malformed value reads as null rather than NaN, and callers treat null as "no
 * history" — see isSessionExpired for why that is the safe direction here.
 */
export function readLastActivity(store: ActivityStore): number | null {
  let raw: string | null
  try {
    raw = store.getItem(LAST_ACTIVITY_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Has the session expired, given the stored activity time?
 *
 * A missing timestamp is NOT treated as expired. That looks like the unsafe direction
 * and is not: this runs on app load, where a signed-in user with no stored timestamp is
 * the ordinary case of a first sign-in on a fresh browser profile (or one where storage
 * was cleared). Signing them straight back out would make the app unusable. The
 * consequence of being wrong here is bounded to one window, because the caller records
 * activity immediately after this check — and the server enforces its own timeout
 * against a record the client cannot touch, which is what actually closes the hole.
 *
 * A timestamp in the future is treated as valid rather than clamped: a clock adjustment
 * is not evidence of anything, and the next tick re-evaluates against the corrected time.
 */
export function isSessionExpired(
  lastActivity: number | null,
  now: number = Date.now(),
  timeoutMs: number = CLIENT_IDLE_TIMEOUT_MS,
): boolean {
  if (lastActivity === null) return false
  return now - lastActivity >= timeoutMs
}

/**
 * Milliseconds until the session should expire — what to set the next timer to.
 *
 * Never negative, and never zero: a zero-delay timeout would spin. Callers that need to
 * know "is it already expired" ask isSessionExpired; this only answers "when next".
 */
export function msUntilExpiry(
  lastActivity: number | null,
  now: number = Date.now(),
  timeoutMs: number = CLIENT_IDLE_TIMEOUT_MS,
): number {
  if (lastActivity === null) return timeoutMs
  return Math.max(1, lastActivity + timeoutMs - now)
}

/**
 * DOM events counted as activity.
 *
 * Deliberately interaction events only — no `mousemove`, and no `scroll` from smooth
 * scrolling or an animation. A timeout that any incidental cursor drift resets is not a
 * timeout. `visibilitychange` is included because returning to a backgrounded tab is a
 * genuine sign of a present user, and it is also the moment a throttled timer needs
 * re-evaluating against the wall clock.
 */
export const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'visibilitychange',
] as const
