'use client'

import { useEffect, useState } from 'react'

// iOS Body at the first accessibility text size (AX1). Below it the app's layouts hold
// as designed; from it up, pinned footers stop pinning and wide labels reflow.
export const ACCESSIBILITY_ROOT_FONT_PX = 28

/** The root font size in px, which follows the iOS Text Size setting (globals.css). */
export function rootFontPx(): number {
  if (typeof window === 'undefined') return 16
  const size = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) ? size : 16
}

/**
 * True when the driver uses an accessibility text size (Settings › Accessibility ›
 * Larger Text). The app is rem-based, so everything grows with the text; at these sizes a
 * pinned footer can cover more than half the screen, so layouts that pin content switch
 * to flowing it instead. Re-read on resize, which is how WKWebView reports a Text Size
 * change made while the app is open.
 */
export function useAccessibilityTextSize(): boolean {
  const [large, setLarge] = useState(false)
  useEffect(() => {
    const read = () => setLarge(rootFontPx() >= ACCESSIBILITY_ROOT_FONT_PX)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])
  return large
}
