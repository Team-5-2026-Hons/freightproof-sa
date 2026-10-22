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

// The floating action sits 16px above the bar's pill. The pill itself sits max(inset, 16px)
// above the screen edge (.pb-safe in globals.css), so these are written against that max(),
// not against `inset + a constant`: with no home indicator (Android gesture bar, browser PWA)
// the inset reads 0, the 16px floor wins, and an `N px + inset` offset comes out 16px short —
// which left the action 2px above the bar, reading as touching it.
//   action bottom = pill top (max + 62) + 16 gap          = max + 78
//   scroll padding = action top (bottom + 56 button) + 32 = max + 166, so the last row ends
//   a clear 32px above the action instead of behind it.
const ACTION_BOTTOM = 'bottom-[calc(max(env(safe-area-inset-bottom),16px)+78px)]'
const CLEAR_TAB_BAR_AND_ACTION = 'pb-[calc(max(env(safe-area-inset-bottom),16px)+166px)]'

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
        <div className={cn('pointer-events-none fixed inset-x-4 z-sticky', ACTION_BOTTOM)}>
          <div className="pointer-events-auto">{action}</div>
        </div>
      )}
      <BottomNav />
    </main>
  )
}
