// Where the driver was when the app last left their hands mid-workflow, so a cold start can
// put them back there.
//
// Android recreates the WebView after a native hand-off (the document scanner, the camera)
// whenever it needs the memory, and Capacitor then loads the start URL — `/`. Everything in
// JavaScript is gone, so the driver who was scanning the linehaul sheet lands on Home with no
// idea why. Their draft survived in localStorage (usePhaseDraft); the screen did not. This
// remembers the screen the same way, and app/(app)/template.tsx replays it on the first
// screen of a session when that screen is Home.
//
// localStorage, not sessionStorage: a recreated WebView is a new session, which is the one
// case this exists for. Bound to the signed-in account so one driver is never dropped into
// another's step on a shared phone, and aged out so a driver who comes back the next day
// starts from Home like anyone else.

import { ROUTES, SUBSTITUTION_PATH } from '@/lib/constants/routes'
import { PHASE_STEP_PREFIX } from '@/lib/phase/routes'

export const RESUME_SCREEN_KEY = 'fp:resume-screen'

// True until the first screen of this JavaScript session has mounted. A cold start is the
// only moment a remembered screen is replayed; module state, so a later visit to Home
// within the same session is just a visit to Home. Lives here rather than in the template
// file because Next allows a template no exports beyond its default.
let isFirstScreenOfSession = true

/** True exactly once per JavaScript session: on the first screen to ask. */
export function consumeColdStart(): boolean {
  const coldStart = isFirstScreenOfSession
  isFirstScreenOfSession = false
  return coldStart
}

/** Test-only: a fresh session, the way the WebView gets one per launch. */
export function __resetColdStartForTests(): void {
  isFirstScreenOfSession = true
}

// Longer than any scanner or camera round trip, with room for a phone call in between;
// short enough that a step left yesterday is not forced back onto the driver.
export const RESUME_MAX_AGE_MS = 30 * 60 * 1000

interface ResumeRecord {
  url: string
  actorId: string | null
  savedAt: string
}

// The screens a driver is mid-task on. Tab roots, lists and trip pages are not: landing
// back on Home from those is what a cold start should do.
const RESUMABLE_PREFIXES = [PHASE_STEP_PREFIX, ROUTES.inTransit, SUBSTITUTION_PATH] as const

export function isResumableRoute(pathname: string): boolean {
  return RESUMABLE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isResumeRecord(value: unknown): value is ResumeRecord {
  return typeof value === 'object' && value !== null
    && typeof (value as ResumeRecord).url === 'string'
    && typeof (value as ResumeRecord).savedAt === 'string'
    && ('actorId' in value)
}

/** Record the screen on display (pathname plus query), if it is one worth coming back to. */
export function rememberScreen(url: string, actorId: string | null, now: Date = new Date()): void {
  const store = storage()
  if (store === null) return
  const pathname = url.split('?')[0]
  if (!isResumableRoute(pathname)) return
  const record: ResumeRecord = { url, actorId, savedAt: now.toISOString() }
  try {
    store.setItem(RESUME_SCREEN_KEY, JSON.stringify(record))
  } catch (err) {
    // Full or blocked storage: the worst case is a cold start on Home, which is today's behaviour.
    console.warn('resume: could not remember the current screen', err)
  }
}

/** The driver left the workflow on purpose (a tab root, sign-out): nothing to come back to. */
export function forgetScreen(): void {
  try {
    storage()?.removeItem(RESUME_SCREEN_KEY)
  } catch (err) {
    console.warn('resume: could not clear the remembered screen', err)
  }
}

/**
 * The screen to put this driver back on, or null. Single use: read and cleared together, so
 * a second cold start (or a driver who leaves again) is never bounced twice. Rejects a record
 * saved by another account, one older than RESUME_MAX_AGE_MS, or one that is no longer a
 * workflow route (a route renamed between builds).
 */
export function takeResumeScreen(actorId: string | null, now: Date = new Date()): string | null {
  const store = storage()
  if (store === null) return null
  let raw: string | null
  try {
    raw = store.getItem(RESUME_SCREEN_KEY)
  } catch {
    return null
  }
  forgetScreen()
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isResumeRecord(parsed)) return null
  if (parsed.actorId !== actorId) return null
  const savedAt = Date.parse(parsed.savedAt)
  if (!Number.isFinite(savedAt) || now.getTime() - savedAt > RESUME_MAX_AGE_MS) return null
  if (!isResumableRoute(parsed.url.split('?')[0])) return null
  return parsed.url
}
