"use client"

import type { LucideIcon } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface Tab {
  id: string
  label: string
  icon?: LucideIcon
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex border-b-2 border-outline', className)}>
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-3 text-[14px] font-semibold leading-5 tracking-[0.006em]',
              'border-b-2 -mb-0.5 transition-colors duration-150',
              isActive
                ? 'border-secondary text-secondary'
                : 'border-transparent text-surface-on-variant hover:text-surface-on',
            )}
          >
            {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
