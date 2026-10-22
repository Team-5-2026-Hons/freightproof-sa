'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a control keeps saying "Copied" before it goes back to "Copy". */
export const COPIED_RESET_MS = 2000

export interface CopyToClipboard {
  /** True only between a write the clipboard accepted and the reset delay. */
  copied: boolean
  copy: (text: string) => Promise<void>
}

/**
 * One clipboard copy for every "Copy" control. `copied` is set only after the write succeeds, so a
 * refused write (insecure context, denied permission) can never read as "Copied"; the refusal is
 * logged and the value stays selectable on screen.
 */
export function useCopyToClipboard(): CopyToClipboard {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback((): void => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    resetTimer.current = null
  }, [])

  // An unmounted control has nothing left to reset.
  useEffect(() => clearTimer, [clearTimer])

  const copy = useCallback(async (text: string): Promise<void> => {
    try {
      // navigator.clipboard is undefined outside a secure context; that is a refusal too.
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn('useCopyToClipboard: clipboard write refused', error)
      return
    }
    setCopied(true)
    clearTimer()
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }, [clearTimer])

  return { copied, copy }
}
