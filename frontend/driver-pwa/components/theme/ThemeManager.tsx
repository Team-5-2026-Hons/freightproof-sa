// frontend/driver-pwa/components/theme/ThemeManager.tsx
'use client'

import { useEffect } from 'react'
import {
  DARK_SCHEME_QUERY,
  applyTheme,
  getThemePref,
  subscribeThemePref,
} from '@/lib/theme'

/**
 * Keeps <html>'s theme class correct for as long as the app is open. Renders nothing.
 *
 * THEME_INIT_SCRIPT (app/layout.tsx) already applied the right theme before first paint;
 * this covers the two things a one-shot script cannot:
 *
 *  1. The device flipping to dark *while the app is open* — Android and iOS both do this
 *     on a schedule at sunset, which is exactly when a driver is mid-leg and will not be
 *     relaunching the app.
 *  2. A Settings change made on another screen, via the preference's own subscription.
 *
 * Mounted in the root layout rather than the (app) group so the login and OTP screens are
 * themed too — a driver signing in at night should not get a white screen first.
 */
export function ThemeManager() {
  useEffect(() => {
    // Re-assert on mount: the inline script runs before localStorage is necessarily
    // readable in every packaged-shell edge case, and this is the cheap correction.
    applyTheme(getThemePref())

    const unsubscribe = subscribeThemePref(() => applyTheme(getThemePref()))

    // matchMedia is absent in jsdom and in older WebViews — the preference still works,
    // it just stops tracking the OS. Guarded rather than assumed.
    if (typeof window.matchMedia !== 'function') return unsubscribe

    const media = window.matchMedia(DARK_SCHEME_QUERY)
    // Only 'system' defers to the device; an explicit light/dark choice must survive the
    // OS changing under it. applyTheme re-reads the preference, so this is a no-op then.
    const handleSchemeChange = () => applyTheme(getThemePref())

    media.addEventListener('change', handleSchemeChange)

    return () => {
      media.removeEventListener('change', handleSchemeChange)
      unsubscribe()
    }
  }, [])

  return null
}
