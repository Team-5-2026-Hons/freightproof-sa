'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Tabs, type Tab } from './Tabs'

// Below this the timeline and a 400px panel cannot both hold a comfortable measure, so
// the panel stops being permanent and becomes an on-demand overlay instead.
const DOCKED_QUERY = '(min-width: 1280px)'
function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(DOCKED_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
function dockedSnapshot(): boolean { return window.matchMedia(DOCKED_QUERY).matches }
function serverSnapshot(): boolean { return false }

export function useDocked(): boolean {
  return useSyncExternalStore(subscribe, dockedSnapshot, serverSnapshot)
}

interface Props {
  tabs: readonly Tab[]
  active: string
  onSelect: (id: string) => void
  title: string
  /** Overlay only. The docked panel is permanent and has nothing to close. */
  onClose: () => void
  /** Overlay only: whether the on-demand panel is currently raised. */
  overlayOpen: boolean
  ariaLabel: string
  children: ReactNode
}

/** One content surface for a subject's supporting detail. Docked it is a permanent
 *  full-height column that owns its own view switcher; below the dock width it falls
 *  back to the overlay the caller raises. */
export function DetailPanel({ tabs, active, onSelect, title, onClose, overlayOpen, ariaLabel, children }: Props) {
  const docked = useDocked()
  const panelId = 'detail-panel-content'

  if (!docked) {
    if (!overlayOpen) return null
    return <Modal open onClose={onClose} title={title} size="lg">{children}</Modal>
  }

  return (
    <aside aria-label={ariaLabel} className="flex w-[400px] shrink-0 flex-col border-l border-outline-v/30 bg-surf-low">
      <div className="shrink-0 border-b border-outline-v/30 p-4">
        <Tabs tabs={tabs} active={active} onChange={onSelect} panelId={panelId} ariaLabel={ariaLabel} size="sm" />
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-5">
        {children}
      </div>
    </aside>
  )
}
