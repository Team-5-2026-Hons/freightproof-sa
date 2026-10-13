'use client'

import { useEffect, useRef } from 'react'
import { exceptionRowId } from '@/components/domain/ExceptionRow'

/** A control that changes the view around the selection, not the selection itself, carries this
 * attribute so using it never deselects the exception (e.g. expanding or switching the timeline). */
export const KEEP_EXCEPTION_SELECTION_ATTR = 'data-keep-exception-selection'

/** Selection follows the record, rather than sticking after the reader clicks elsewhere.
 * Capture runs before navigation controls, so their own action remains the final action. */
export function useDismissExceptionSelection(selectedId: string | null, onDismiss: () => void): void {
  // The latest callback is read through a ref so the listener is bound once per selection,
  // not re-bound on every render of a caller that passes an inline function.
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    if (!selectedId) return
    function dismissOutside(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return
      if (event.target.closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)) return
      const record = event.target.closest('[data-exception-id]')
      if (record?.getAttribute('data-exception-id') === selectedId) return
      // Another timeline row will select its own record; do not navigate twice for it.
      const button = event.target.closest('button[id]')
      if (button?.id.startsWith(exceptionRowId(''))) return
      dismissRef.current()
    }
    document.addEventListener('click', dismissOutside, true)
    return () => document.removeEventListener('click', dismissOutside, true)
  }, [selectedId])
}
