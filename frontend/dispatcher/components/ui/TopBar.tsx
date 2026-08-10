'use client'

// ForensicControls (mounted below) reads useForensicMode, a client hook —
// coupling this primitive to app context is an accepted tradeoff for
// guaranteeing the forensic toggle appears consistently on every TopBar.

import type { ReactNode } from 'react'
import { ForensicControls } from '@/components/blockchain/ForensicControls'

interface TopBarProps {
  title: string
  /** Badge rendered inline next to the title — e.g. an admin-only indicator. */
  badge?: ReactNode
  /** Secondary line below title — shown in sec colour, tabular-nums. */
  sub?: string
  /** Left slot — rendered before the title. Use for back navigation only. */
  left?: ReactNode
  /** Right slot — buttons, chips, etc. Rendered in a flex row with 8px gap. */
  children?: ReactNode
}

export function TopBar({ title, badge, sub, left, children }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-6 h-[60px] bg-surf-lowest border-b border-outline-v/20 shadow-level-1 shrink-0">
      {left}
      <div>
        <div className="flex items-center gap-[8px]">
          <div className="text-[18px] font-[800] tracking-[-0.02em] text-on-surf leading-tight">
            {title}
          </div>
          {badge}
        </div>
        {sub && (
          <div className="text-[11px] font-[500] tracking-[0.03em] text-sec tabular-nums mt-[2px]">
            {sub}
          </div>
        )}
      </div>
      <div className="ml-auto flex gap-2 items-center">
        <ForensicControls />
        {children}
      </div>
    </div>
  )
}
