'use client'

import type { ReactNode } from 'react'

interface TopBarProps {
  title: string
  identity?: ReactNode
  badge?: ReactNode
  sub?: string
  left?: ReactNode
  children?: ReactNode
}

export function TopBar({ title, identity, badge, sub, left, children }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-6 h-[60px] bg-surf-lowest border-b border-outline-v/20 shadow-level-1 shrink-0">
      {left}
      <div className="min-w-0 flex-1">
        {identity ?? (
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
        )}
      </div>
      <div className="ml-auto flex gap-2 items-center shrink-0">
        {children}
      </div>
    </div>
  )
}
