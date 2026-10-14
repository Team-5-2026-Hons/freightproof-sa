'use client'

import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

export interface Tab {
  id: string
  label: string
  icon?: ReactNode
  /** Small trailing count, e.g. the number of exceptions still needing review. */
  badge?: string | number
  /** Raises the badge when the count is something a dispatcher must act on. */
  badgeUrgent?: boolean
}

interface TabsProps {
  tabs: readonly Tab[]
  active: string
  onChange: (id: string) => void
  /** Id of the element this tablist controls, so screen readers pair the two. */
  panelId?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Segmented control. Use for switching between mutually exclusive views of the same
 *  subject — a Switch is for a single on/off setting and cannot express three states. */
export function Tabs({ tabs, active, onChange, panelId, ariaLabel, size = 'md', className }: TabsProps) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex gap-1 rounded-[10px] bg-surf-low p-1', className)}>
      {tabs.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={panelId}
            // Only the selected tab stays in the tab order; the arrow-key roving pattern
            // is what keyboard users expect inside a tablist, not three separate stops.
            tabIndex={isActive ? 0 : -1}
            onKeyDown={event => {
              const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!delta) return
              event.preventDefault()
              const index = tabs.findIndex(t => t.id === active)
              const next = tabs[(index + delta + tabs.length) % tabs.length]
              onChange(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            }}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-[6px] rounded-md font-[700] uppercase tracking-[0.06em] transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec',
              size === 'sm' ? 'px-2 py-[6px] text-[10px]' : 'px-4 py-2 text-[11px]',
              isActive
                ? 'bg-surf-lowest text-on-surf shadow-[0_1px_0_rgba(27,27,28,0.06)]'
                : 'text-on-surf-v hover:bg-surf-high/60 hover:text-on-surf',
            )}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== 0 && (
              <span className={cn(
                'shrink-0 rounded-sm px-[5px] py-px text-[10px] font-[700] tabular-nums',
                tab.badgeUrgent ? 'bg-warn-c text-warn-onc' : 'bg-surf-high text-on-surf-v',
              )}>{tab.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
