// frontend/driver-pwa/lib/theme.ts
//
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

/** The class Tailwind's `darkMode: 'class'` strategy looks for on <html>. */
export const DARK_CLASS = 'dark'

/** The OS-level signal consulted when the preference is 'system'. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const

/** What the driver chose. 'system' defers to the device. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** What actually gets painted, once 'system' has been resolved against the device. */
export type ResolvedTheme = 'light' | 'dark'

// Follow the device by default. A driver starting a night leg gets a dark screen without
// having to find a setting first, and the explicit choices exist for when the device is
// wrong — a phone on auto-dark is still being read in Highveld sun at midday.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (THEME_PREFERENCES as readonly string[]).includes(value)
}

export function getThemePref(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE

  try {
    const stored = window.localStorage.getItem(PREF_THEME)
    // An unrecognised value means a hand-edited or stale key, not a valid choice —
    // fall back rather than writing an unknown string onto <html>.
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
    // Quota exceeded, private browsing, or storage disabled. The theme is still applied
    // and subscribers still notified below, so the choice holds for this session even
    // though it won't survive a relaunch.
    console.warn('setThemePref: failed to persist preference to localStorage')
  }

  applyTheme(pref)
  listeners.forEach((notify) => notify())
}

// Same-tab subscription channel for useSyncExternalStore consumers — the browser's
// native 'storage' event only fires in *other* tabs. Mirrors the pattern in
// lib/constants/preferences.ts, with its own set so the two preferences don't wake
// each other's subscribers.
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

/**
 * Runs before first paint, as the first child of <body> in app/layout.tsx.
 *
 * Without it the page paints light, then React hydrates and flips it — a full-screen
 * white flash on every cold start, which for a driver checking a load at 3am is worse
 * than having no dark mode at all. This is why it is a raw string of JavaScript rather
 * than a component: it has to execute while the parser is still blocked, before React
 * exists on the page.
 *
 * Kept as one expression with no dependencies so it stays inlinable — the key and class
 * name interpolate from the constants above so this copy can never drift from the
 * TypeScript one.
 */
export const THEME_INIT_SCRIPT = `(function(){try{` +
  `var p=window.localStorage.getItem('${PREF_THEME}');` +
  `var dark=p==='dark'||(p!=='light'&&window.matchMedia('${DARK_SCHEME_QUERY}').matches);` +
  `document.documentElement.classList.toggle('${DARK_CLASS}',dark);` +
  // Never allowed to throw: an exception here aborts the inline script and the app
  // paints in the wrong theme. Warn (visible in `npx cap run` logcat / Safari
  // inspector) and let ThemeManager correct it on mount.
  `}catch(e){console.warn('theme-init: could not apply stored theme',e)}})()`
