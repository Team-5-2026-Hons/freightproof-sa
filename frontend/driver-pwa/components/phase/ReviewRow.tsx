'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ReviewRowProps {
  icon: ReactNode
  label: string
  value: ReactNode
  /** Optional thumbnail left of the label — the captured photo itself. */
  media?: ReactNode
  /** A grey pill that goes back to fix this item (Edit, Retake). */
  action?: { label: string; onClick: () => void; accessibleName?: string }
  className?: string
}

/**
 * One captured item on a review step: an icon, the label over the value,
 * and the way back to change it. Rows are separated by an inset hairline that starts
 * under the text, as in an iOS list.
 */
export function ReviewRow({ icon, label, value, media, action, className }: ReviewRowProps) {
  return (
    <div className={cn('grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-4 py-3.5', className)}>
      <span aria-hidden className="flex text-surface-on">{icon}</span>
      <div className="flex min-w-0 items-center gap-3">
        {media}
        <div className="min-w-0">
          <p className="text-subhead text-surface-on-variant">{label}</p>
          <div className="truncate text-body font-medium text-surface-on">{value}</div>
        </div>
      </div>
      {action !== undefined ? (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.accessibleName}
          // 44pt hit area around the 36pt pill the render draws.
          className="flex min-h-11 items-center"
        >
          <span className="inline-flex h-9 items-center rounded-full bg-fill px-4 text-subhead font-semibold text-surface-on transition-transform duration-100 active:scale-95">
            {action.label}
          </span>
        </button>
      ) : <span />}
    </div>
  )
}
