'use client'

import { useEffect, useRef, type RefObject } from 'react'

export const OPENER_ATTR = 'data-opener'

/**
 * Keyboard focus for an inline form that replaces its opening button. When a form opens, focus goes to
 * its first field; when it closes (Back, cancel or a save), focus returns to the button that opened it.
 * The opener is unmounted while the form is open, so it is found in the DOM after each change rather
 * than held as a node that no longer exists. Does nothing on mount: only a form the reader actually
 * opened and closed moves focus.
 *
 * `openForm` is which form is open (null for none); attach the returned ref to an element that holds
 * the openers and the forms.
 */
export function useOpenerFocus<K extends string>(openForm: K | null): RefObject<HTMLDivElement | null> {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef<K | null>(null)
  useEffect(() => {
    const was = previous.current
    previous.current = openForm
    if (openForm !== null) root.current?.querySelector<HTMLElement>('textarea, input, select')?.focus()
    else if (was !== null) root.current?.querySelector<HTMLElement>(`[${OPENER_ATTR}="${was}"]`)?.focus()
  }, [openForm])
  return root
}
