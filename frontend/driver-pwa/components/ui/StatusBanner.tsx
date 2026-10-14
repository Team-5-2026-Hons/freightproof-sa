import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'success' | 'attention' | 'neutral'

// Ground, text and dot per tone. Tints, not the saturated *-container chip fills: a
// banner is a sentence the driver reads, and a loud box makes it harder to read, not
// easier to notice.
const TONE: Record<StatusTone, { ground: string; body: string; dot: string }> = {
  success:   { ground: 'bg-success-tint text-success-ink',     body: 'text-success-ink',      dot: 'bg-success' },
  attention: { ground: 'bg-attention-tint text-attention-ink', body: 'text-attention-ink',    dot: 'bg-attention' },
  neutral:   { ground: 'bg-fill text-surface-on',              body: 'text-surface-on-variant', dot: 'bg-surface-on' },
}

interface StatusBannerProps {
  tone: StatusTone
  /** One line: what is true right now. */
  title: string
  /** One sentence: what to do next. Optional. */
  children?: ReactNode
  /** Replaces the tone dot, e.g. a clock for "Starts today at 12:00". */
  icon?: ReactNode
  /**
   * Announce changes to assistive tech. Off by default — most banners describe a settled
   * state, and a live region that re-announces on every render is noise.
   */
  live?: boolean
  className?: string
}

/** The overhaul's status line: tinted ground, dot, bold state, plain next step. */
export function StatusBanner({ tone, title, children, icon, live = false, className }: StatusBannerProps) {
  const t = TONE[tone]
  return (
    <div
      role={live ? 'status' : undefined}
      className={cn('flex gap-3.5 rounded-xl px-4 py-4', t.ground, className)}
    >
      {icon ?? (
        <span data-banner-dot aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', t.dot)} />
      )}
      <div className="min-w-0">
        <p className="text-headline">{title}</p>
        {children !== undefined && <p className={cn('text-subhead', t.body)}>{children}</p>}
      </div>
    </div>
  )
}
