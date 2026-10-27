'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const COPIED_RESET_MS = 2000

export interface CopyToClipboard {
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

  useEffect(() => clearTimer, [clearTimer])

  const copy = useCallback(async (text: string): Promise<void> => {
    try {
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
