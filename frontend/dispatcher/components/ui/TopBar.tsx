import type { ReactNode } from 'react'

interface TopBarProps {
  title: string
  /** Secondary line below title — shown in sec colour, tabular-nums. */
  sub?: string
  /** Left slot — rendered before the title. Use for back navigation only. */
  left?: ReactNode
  /** Right slot — buttons, chips, etc. Rendered in a flex row with 8px gap. */
  children?: ReactNode
}

export function TopBar({ title, sub, left, children }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-6 h-[60px] bg-surf-lowest border-b border-outline-v/20 shadow-level-1 shrink-0">
      {left}
      <div>
        <div className="text-[18px] font-[800] tracking-[-0.02em] text-on-surf leading-tight">
          {title}
        </div>
        {sub && (
          <div className="text-[11px] font-[500] tracking-[0.03em] text-sec tabular-nums mt-[2px]">
            {sub}
          </div>
        )}
      </div>
      {children && (
        <div className="ml-auto flex gap-2 items-center">
          {children}
        </div>
      )}
    </div>
  )
}
