'use client'

import { useEffect } from 'react'
import { rootFontPx } from '@/lib/hooks/useAccessibilityTextSize'

export const MAX_ROOT_FONT_PX = 28

/** Holds the root font at MAX_ROOT_FONT_PX when the Text Size setting asks for more. */
export function TextSizeCap() {
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      root.style.removeProperty('font-size')
      if (rootFontPx() > MAX_ROOT_FONT_PX) root.style.fontSize = `${MAX_ROOT_FONT_PX}px`
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty('font-size')
    }
  }, [])
  return null
}
