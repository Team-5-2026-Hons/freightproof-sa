'use client'

import { useEffect, useRef } from 'react'
import { exceptionRowId } from '@/components/domain/ExceptionRow'

/** A control that changes the view around the selection, not the selection itself, carries this
 * attribute so using it never deselects the exception (e.g. expanding or switching the timeline). */
export const KEEP_EXCEPTION_SELECTION_ATTR = 'data-keep-exception-selection'

// Escape belongs to these first: a form field may use it itself, and the overlay's <dialog>
// closes on it, which already leaves the record.
const ESCAPE_OWNERS = 'input, select, textarea, dialog[open]'

// Set on the panel record: the id of the phase card that holds the exception's timeline row.
const PHASE_ANCHOR_ATTR = 'data-phase-anchor'

function returnFocusToTimeline(exceptionId: string, phaseAnchorId: string | null): void {
  const row = document.getElementById(exceptionRowId(exceptionId))
  if (row && !row.closest('[hidden]')) {
    row.focus({ preventScroll: false })
    return
  }
  const toggle = phaseAnchorId ? document.getElementById(phaseAnchorId)?.querySelector<HTMLElement>('button[aria-expanded]') : null
  toggle?.focus({ preventScroll: false })
}

/** Selection follows the record, rather than sticking after the reader clicks elsewhere.
 * Capture runs before navigation controls, so their own action remains the final action.
 * Escape is the keyboard's way to deselect. */
export function useDismissExceptionSelection(selectedId: string | null, onDismiss: () => void): void {
  // The latest callback is read through a ref so the listener is bound once per selection,
  // not re-bound on every render of a caller that passes an inline function.
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    if (!selectedId) return
    function dismissOutside(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return
      // A drag that selects text (to copy a seal number, say) ends in a click; it is reading, not leaving.
      const textSelection = window.getSelection()
      if (textSelection && !textSelection.isCollapsed) return
      if (event.target.closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)) return
      const record = event.target.closest('[data-exception-id]')
      if (record?.getAttribute('data-exception-id') === selectedId) return
      // Another timeline row will select its own record; do not navigate twice for it.
      const button = event.target.closest('button[id]')
      if (button?.id.startsWith(exceptionRowId(''))) return
      dismissRef.current()
    }
    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(ESCAPE_OWNERS)) return
      const record = document.activeElement?.closest('[data-exception-id]')
      const fromRecord = record?.getAttribute('data-exception-id') === selectedId
      dismissRef.current()
      // Leaving the record would otherwise drop focus to <body>: return it to where the reader
      // came from, the row, or its phase card when the view does not show the row (Minimised).
      if (fromRecord && selectedId) returnFocusToTimeline(selectedId, record?.getAttribute(PHASE_ANCHOR_ATTR) ?? null)
    }
    document.addEventListener('click', dismissOutside, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('click', dismissOutside, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [selectedId])
}
