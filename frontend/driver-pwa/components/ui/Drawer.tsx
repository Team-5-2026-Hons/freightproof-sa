'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  children: ReactNode
  title?: string
}

const panelClasses = {
  left:   { container: 'left-0 top-0 h-full w-80',                           open: 'translate-x-0',  closed: '-translate-x-full' },
  right:  { container: 'right-0 top-0 h-full w-80',                          open: 'translate-x-0',  closed: 'translate-x-full'  },
  bottom: { container: 'bottom-0 left-0 w-full rounded-t-2xl max-h-[85vh]',  open: 'translate-y-0',  closed: 'translate-y-full'  },
}

// NOTE (deviation from @radix-ui/react-dialog): the drawer is kept mounted at
// all times and only translated off-canvas via CSS — ProfilePanel (its one
// remaining consumer since the hamburger + NavDrawer were replaced by
// BottomNav) renders it unconditionally from AppShell and relies on that to
// avoid remounting its contents on every open/close. Radix's Dialog.Content, ported with
// `forceMount` to get the same "stays mounted while closed" contract, runs
// `hideOthers(content)` in a mount-only effect (empty dep array) inside
// DialogContentModal — meaning it would aria-hide the entire rest of the app
// the instant AppShell mounts, permanently, since the drawer never unmounts to
// trigger the cleanup. That's a correctness regression, not a style one, so
// this component stays hand-rolled (see packet STOP CONDITIONS) — restyled
// onto the shared cn()/theme tokens and the zIndex scale, everything else the
// same as the pre-migration implementation.
export function Drawer({ open, onClose, side = 'right', children, title }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const { container, open: openClass, closed } = panelClasses[side]

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-overlay transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        // The panel stays mounted while closed (only translated off-canvas), so
        // without these attributes screen readers and find-in-page would surface
        // its contents on every screen. React 19 supports the `inert` boolean
        // prop natively; both attributes are omitted entirely while open.
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-modal',
          'transition-transform duration-300 ease-out overflow-y-auto',
          container,
          open ? openClass : closed,
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
            <h2 className="text-base font-bold text-surface-on">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close drawer"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </>
  )
}
