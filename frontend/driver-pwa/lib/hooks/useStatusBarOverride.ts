'use client'

import { useEffect } from 'react'
import { setStatusBarOverride } from '@/lib/status-bar'
import type { ResolvedTheme } from '@/lib/theme'

/**
 * Holds the status bar to `surface` while the calling screen is mounted, then hands it back
 * to the app theme. For screens that paint a fixed surface whatever the theme setting.
 */
export function useStatusBarOverride(surface: ResolvedTheme): void {
  useEffect(() => {
    setStatusBarOverride(surface)
    return () => setStatusBarOverride(null)
  }, [surface])
}
