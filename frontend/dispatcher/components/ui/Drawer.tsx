'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

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
          className="fixed inset-0 bg-black/40 z-[40] transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-[50]',
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
