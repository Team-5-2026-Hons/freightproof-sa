'use client'

import { useEffect } from 'react'
import { rootFontPx } from '@/lib/hooks/useAccessibilityTextSize'

// iOS Body at the first accessibility text size (AX1). The app's layouts are verified up
// to here (25 screens checked, and read by eye). Above it, because spacing,
// icons and tiles are rem-based and grow with the text, the In Transit map collapses and
// paired controls stop fitting side by side. Capping is Apple's own answer for content
// that cannot reflow further (UIKit's maximumContentSizeCategory): a driver on AX2–AX5
// gets the largest text the layouts carry, never a broken screen. Raising it needs the
// spacing system moved to px (text alone in rem) first.
export const MAX_ROOT_FONT_PX = 28

/** Holds the root font at MAX_ROOT_FONT_PX when the Text Size setting asks for more. */
export function TextSizeCap() {
  useEffect(() => {
    const root = document.documentElement
    // Re-measured from scratch each time: drop our own cap, read what the setting asks
    // for, re-apply only if it is too big. All in one task, so nothing paints between.
    const apply = () => {
      root.style.removeProperty('font-size')
      if (rootFontPx() > MAX_ROOT_FONT_PX) root.style.fontSize = `${MAX_ROOT_FONT_PX}px`
    }
    apply()
    // WKWebView reports a Text Size change made while the app is open as a resize.
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty('font-size')
    }
  }, [])
  return null
}
