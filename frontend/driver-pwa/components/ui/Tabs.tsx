'use client'

import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface Tab {
  id: string
  label: string
  icon?: ReactNode
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex gap-1 bg-surface-container-low rounded-xl p-1', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg',
              'text-sm font-bold uppercase tracking-wider transition-all duration-200',
              isActive
                ? 'bg-surface-container-lowest text-surface-on shadow-ambient-sm'
                : 'text-surface-on-variant hover:text-surface-on hover:bg-surface-container',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
