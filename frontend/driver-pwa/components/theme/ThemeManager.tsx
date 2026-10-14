'use client'

import { useEffect } from 'react'
import {
  DARK_SCHEME_QUERY,
  applyTheme,
  getThemePref,
  resolveTheme,
  subscribeThemePref,
} from '@/lib/theme'
import { syncStatusBarToTheme } from '@/lib/status-bar'

// The DOM class and the native status bar move together, so the clock and battery glyphs
// always contrast with the screen under them.
function applyCurrentTheme(): void {
  const pref = getThemePref()
  applyTheme(pref)
  syncStatusBarToTheme(resolveTheme(pref))
}

/**
 * Keeps <html>'s theme class correct while the app is open. Renders nothing.
 *
 * THEME_INIT_SCRIPT (app/layout.tsx) applies the theme before first paint; this covers
 * OS scheme changes mid-session and Settings changes from other screens. Mounted in the
 * root layout (not the (app) group) so login/OTP screens are themed too.
 */
export function ThemeManager() {
  useEffect(() => {
    // Re-assert on mount: localStorage isn't always readable when the inline script runs.
    applyCurrentTheme()

    const unsubscribe = subscribeThemePref(applyCurrentTheme)

    // matchMedia is absent in jsdom and older WebViews; preference still works, just
    // stops tracking the OS.
    if (typeof window.matchMedia !== 'function') return unsubscribe

    const media = window.matchMedia(DARK_SCHEME_QUERY)
    media.addEventListener('change', applyCurrentTheme)

    return () => {
      media.removeEventListener('change', applyCurrentTheme)
      unsubscribe()
    }
  }, [])

  return null
}
