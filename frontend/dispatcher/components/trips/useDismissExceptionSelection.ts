'use client'

import { useEffect, useRef } from 'react'
import { exceptionRowId } from '@/components/domain/ExceptionRow'

export const KEEP_EXCEPTION_SELECTION_ATTR = 'data-keep-exception-selection'

const ESCAPE_OWNERS = 'input, select, textarea, dialog[open]'

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

const EXCEPTION_RECORD_ATTRS = ['data-exception-id'] as const

/** The element inside `target` that carries the selected record's id under one of `attrs`, if any. */
function recordIdAt(target: Element | null | undefined, attrs: readonly string[]): string | null {
  for (const attr of attrs) {
    const record = target?.closest(`[${attr}]`)
    if (record) return record.getAttribute(attr)
  }
  return null
}

/** Selection follows the record, rather than sticking after the reader clicks elsewhere.
 * Capture runs before navigation controls, so their own action remains the final action.
 * Escape is the keyboard's way to deselect. `recordAttrs` names the attributes that mark the
 * selected record on the page: an exception by default; an incident passes its own, so a click
 * on the incident itself (its row, or its entry in the Info panel) keeps it selected. */
export function useDismissExceptionSelection(selectedId: string | null, onDismiss: () => void, recordAttrs: readonly string[] = EXCEPTION_RECORD_ATTRS): void {
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    if (!selectedId) return
    function dismissOutside(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return
      const textSelection = window.getSelection()
      if (textSelection && !textSelection.isCollapsed) return
      if (event.target.closest(`[${KEEP_EXCEPTION_SELECTION_ATTR}]`)) return
      if (recordIdAt(event.target, recordAttrs) === selectedId) return
      const button = event.target.closest('button[id]')
      if (button?.id.startsWith(exceptionRowId(''))) return
      dismissRef.current()
    }
    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(ESCAPE_OWNERS)) return
      const record = document.activeElement?.closest('[data-exception-id]')
      const fromRecord = recordAttrs === EXCEPTION_RECORD_ATTRS && record?.getAttribute('data-exception-id') === selectedId
      dismissRef.current()
      if (fromRecord && selectedId) returnFocusToTimeline(selectedId, record?.getAttribute(PHASE_ANCHOR_ATTR) ?? null)
    }
    document.addEventListener('click', dismissOutside, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('click', dismissOutside, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [selectedId, recordAttrs])
}
