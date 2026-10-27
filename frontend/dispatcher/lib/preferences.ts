import { ROUTES } from '@/lib/constants/routes'

const PREFERENCES_STORAGE_KEY = 'fp.preferences.v1'

export const LANDING_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard', href: ROUTES.home },
  { id: 'exceptions', label: 'Exceptions', href: ROUTES.exceptions },
  { id: 'history', label: 'Trip History', href: ROUTES.history },
] as const

export type LandingPageId = (typeof LANDING_OPTIONS)[number]['id']

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const

export type RowsPerPage = (typeof ROWS_PER_PAGE_OPTIONS)[number]

export interface Preferences {
  landingPage: LandingPageId
  rowsPerPage: RowsPerPage
}

export const DEFAULT_PREFERENCES: Preferences = { landingPage: 'dashboard', rowsPerPage: 25 }

function isLandingPageId(value: unknown): value is LandingPageId {
  return LANDING_OPTIONS.some(option => option.id === value)
}

function isRowsPerPage(value: unknown): value is RowsPerPage {
  return ROWS_PER_PAGE_OPTIONS.some(option => option === value)
}

/** Reads each field independently, so one corrupt or retired value falls back to its
 *  default without discarding the other. Never throws: storage can be blocked, and a
 *  preference is never worth breaking the page that asked for it. */
export function readPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES

  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return DEFAULT_PREFERENCES
    const { landingPage, rowsPerPage } = stored as Record<string, unknown>
    return {
      landingPage: isLandingPageId(landingPage) ? landingPage : DEFAULT_PREFERENCES.landingPage,
      rowsPerPage: isRowsPerPage(rowsPerPage) ? rowsPerPage : DEFAULT_PREFERENCES.rowsPerPage,
    }
  } catch (error) {
    console.warn('preferences: could not read stored preferences, using defaults', error)
    return DEFAULT_PREFERENCES
  }
}

/** Merges `patch` into the stored preferences and returns the result. A failed write is
 *  logged and the in-memory result is still returned, so the control the dispatcher just
 *  used keeps showing their choice for this visit. */
export function writePreferences(patch: Partial<Preferences>): Preferences {
  const next = { ...readPreferences(), ...patch }
  if (typeof window === 'undefined') return next

  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    console.warn('preferences: failed to persist preferences', error)
  }
  return next
}

/** The route a landing-page id maps to. */
export function landingHref(id: LandingPageId): string {
  return (LANDING_OPTIONS.find(option => option.id === id) ?? LANDING_OPTIONS[0]).href
}
