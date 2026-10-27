'use client'

import type { ReactNode } from 'react'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import { cn } from '@/lib/utils'

interface TabSubpageProps {
  title: string
  subtitle?: string
  backLabel: string
  onBack: () => void
  right?: ReactNode
  action?: ReactNode
  children: ReactNode
}

const CLEAR_TAB_BAR = 'pb-[calc(96px+env(safe-area-inset-bottom))]'

const ACTION_BOTTOM = 'bottom-[calc(max(env(safe-area-inset-bottom),16px)+78px)]'
const CLEAR_TAB_BAR_AND_ACTION = 'pb-[calc(max(env(safe-area-inset-bottom),16px)+166px)]'

/**
 * A screen pushed from a tab that keeps the tab bar (HIG tab-bars: "Make sure the tab bar
 * is visible when people navigate to different sections"): the trip page
 * and the "See all" lists. Drive mode and phase steps stay full-screen instead.
 */
export function TabSubpage({ title, subtitle, backLabel, onBack, right, action, children }: TabSubpageProps) {
  return (
    <main className={cn('flex min-h-dvh flex-col', action === undefined ? CLEAR_TAB_BAR : CLEAR_TAB_BAR_AND_ACTION)}>
      <SubpageHeader title={title} subtitle={subtitle} backLabel={backLabel} onBack={onBack} right={right} />
      {children}
      {action !== undefined && (
        <div className={cn('pointer-events-none fixed inset-x-4 z-sticky', ACTION_BOTTOM)}>
          <div className="pointer-events-auto">{action}</div>
        </div>
      )}
      <BottomNav />
    </main>
  )
}
