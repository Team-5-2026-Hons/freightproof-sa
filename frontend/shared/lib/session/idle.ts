// Pure, dependency-free inactivity-timeout logic shared by both apps. The backend
// enforces the same window independently (backend/app/auth/sessions.py) — this half
// exists so the user is actually told why, rather than hitting a 401 on their next click.
// Framework-agnostic on purpose: storage is passed in so it's testable against a plain
// object, and callers in non-browser contexts (PWA static-export prerender) can skip it.

/**
 * How long a session may sit idle before it ends.
 * Must stay in step with SESSION_IDLE_TIMEOUT_MINUTES in backend/app/core/config.py —
 * enforced independently on each side, neither reads the other.
 * An hour, so a dispatcher working a full shift is not signed out between interactions.
 */
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000

const CLIENT_LEAD_MS = 15 * 1000

export const CLIENT_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MS - CLIENT_LEAD_MS

export const LAST_ACTIVITY_KEY = 'fp:last-activity'

/** The minimum subset of Storage this module needs. Lets tests pass a plain stub. */
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
  }
}

/** Forget the stored timestamp. Called on sign-out so the next session starts clean. */
export function clearActivity(store: ActivityStore): void {
  try {
    store.removeItem(LAST_ACTIVITY_KEY)
  } catch {
  }
}

/** The stored last-activity time, or null when there is none or it is unreadable. */
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
 * A missing timestamp is NOT treated as expired — that's the ordinary case of a first
 * sign-in with no stored history, and the server's own timeout is what actually closes
 * the hole. A future timestamp is treated as valid rather than clamped: a clock
 * adjustment is not evidence of anything.
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
 * Never negative or zero (a zero-delay timeout would spin).
 */
export function msUntilExpiry(
  lastActivity: number | null,
  now: number = Date.now(),
  timeoutMs: number = CLIENT_IDLE_TIMEOUT_MS,
): number {
  if (lastActivity === null) return timeoutMs
  return Math.max(1, lastActivity + timeoutMs - now)
}

export const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'visibilitychange',
] as const
