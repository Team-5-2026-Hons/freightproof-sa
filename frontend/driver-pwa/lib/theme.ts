// The driver's light/dark preference: where it is stored, how it resolves against the
// device, and how it reaches the DOM.
//
// Deliberately its own module rather than another entry in lib/constants/preferences.ts.
// A theme is not a flag: it owns a pre-paint script, a DOM mutation and a live
// subscription to the OS, none of which belong in a constants file — and it needs its
// own listener set, so that changing the theme does not re-render every
// tap-to-confirm subscriber in the app.
//
// Device-local, never synced to the backend (same reasoning as the other driver
// preferences): it is a comfort setting, not evidence.

/** localStorage key. Read in two places — here, and inside THEME_INIT_SCRIPT below. */
export const PREF_THEME = 'fp:pref:theme'

export const DARK_CLASS = 'dark'

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const

/** What the driver chose. 'system' defers to the device. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** What actually gets painted, once 'system' has been resolved against the device. */
export type ResolvedTheme = 'light' | 'dark'

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (THEME_PREFERENCES as readonly string[]).includes(value)
}

export function getThemePref(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE

  try {
    const stored = window.localStorage.getItem(PREF_THEME)
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
  } catch {
    console.warn('getThemePref: failed to read preference from localStorage')
    return DEFAULT_THEME_PREFERENCE
  }
}

export function setThemePref(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(PREF_THEME, pref)
  } catch {
    console.warn('setThemePref: failed to persist preference to localStorage')
  }

  applyTheme(pref)
  listeners.forEach((notify) => notify())
}

const listeners = new Set<() => void>()

export function subscribeThemePref(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Resolves 'system' against the device; 'light'/'dark' are returned as given. */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'

  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light'
}

/**
 * Writes the resolved theme onto <html>, which is where every --fp-* variable in
 * app/globals.css is switched. Safe to call repeatedly — classList.toggle with an
 * explicit force argument is idempotent.
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return

  document.documentElement.classList.toggle(DARK_CLASS, resolveTheme(pref) === 'dark')
}

export const THEME_INIT_SCRIPT = [
  '(function(){try{',
  'var p=window.localStorage.getItem(' + JSON.stringify(PREF_THEME) + ');',
  "var dark=p==='dark'||(p!=='light'&&window.matchMedia(" + JSON.stringify(DARK_SCHEME_QUERY) + ').matches);',
  'document.documentElement.classList.toggle(' + JSON.stringify(DARK_CLASS) + ',dark);',
  "}catch(e){console.warn('theme-init: could not apply stored theme',e)}})()",
].join('')
