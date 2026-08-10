'use client'

import { type ReactNode } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

interface Tab {
  id: string
  label: string
  icon?: ReactNode
  // Optional count rendered as a badge after the label (e.g. number of trips
  // in that group). Kept out of the label string so the label stays clean and
  // the badge can wrap/style independently.
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

// Segmented tab bar only — this component owns just the trigger row (no
// Tabs.Content), matching every call site, which renders the active panel
// itself based on the controlled `active` id.
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onChange}>
      <TabsPrimitive.List className={cn('flex gap-1 bg-surface-container-low rounded-xl p-1', className)}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            className={cn(
              // px-2 (not px-4) + whitespace-nowrap keeps "Upcoming" + its count
              // badge on a single line at narrow widths (390px viewport).
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg whitespace-nowrap',
              'text-sm font-bold uppercase tracking-wider transition-all duration-200',
              'text-surface-on-variant hover:text-surface-on hover:bg-surface-container',
              'data-[state=active]:bg-surface-container-lowest data-[state=active]:text-surface-on',
              'data-[state=active]:shadow-ambient-sm data-[state=active]:hover:bg-surface-container-lowest',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] tabular-nums">
                {tab.count}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
