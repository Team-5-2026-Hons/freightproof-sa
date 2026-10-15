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
  /** A floating primary action held just above the tab bar (e.g. Continue Driving). */
  action?: ReactNode
  children: ReactNode
}

// Room for the floating tab bar (62px pill + gaps), plus the floating action when there is
// one. px like the bar: it does not scale with Dynamic Type.
const CLEAR_TAB_BAR = 'pb-[calc(96px+env(safe-area-inset-bottom))]'
const CLEAR_TAB_BAR_AND_ACTION = 'pb-[calc(168px+env(safe-area-inset-bottom))]'

/**
 * A screen pushed from a tab that keeps the tab bar (HIG tab-bars: "Make sure the tab bar
 * is visible when people navigate to different sections" — decision D3): the trip page
 * and the "See all" lists. Drive mode and phase steps stay full-screen instead.
 */
export function TabSubpage({ title, subtitle, backLabel, onBack, right, action, children }: TabSubpageProps) {
  return (
    <main className={cn('flex min-h-dvh flex-col', action === undefined ? CLEAR_TAB_BAR : CLEAR_TAB_BAR_AND_ACTION)}>
      <SubpageHeader title={title} subtitle={subtitle} backLabel={backLabel} onBack={onBack} right={right} />
      {children}
      {action !== undefined && (
        <div className="pointer-events-none fixed inset-x-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-sticky">
          <div className="pointer-events-auto">{action}</div>
        </div>
      )}
      <BottomNav />
    </main>
  )
}
