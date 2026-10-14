'use client'

import { useEffect } from 'react'
import {
  DARK_SCHEME_QUERY,
  applyTheme,
  getThemePref,
  subscribeThemePref,
} from '@/lib/theme'

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
    applyTheme(getThemePref())

    const unsubscribe = subscribeThemePref(() => applyTheme(getThemePref()))

    // matchMedia is absent in jsdom and older WebViews; preference still works, just
    // stops tracking the OS.
    if (typeof window.matchMedia !== 'function') return unsubscribe

    const media = window.matchMedia(DARK_SCHEME_QUERY)
    const handleSchemeChange = () => applyTheme(getThemePref())

    media.addEventListener('change', handleSchemeChange)

    return () => {
      media.removeEventListener('change', handleSchemeChange)
      unsubscribe()
    }
  }, [])

  return null
}
