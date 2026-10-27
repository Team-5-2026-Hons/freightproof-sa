import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'success' | 'attention' | 'neutral'

const TONE: Record<StatusTone, { ground: string; body: string; dot: string }> = {
  success:   { ground: 'bg-success-tint text-success-ink',     body: 'text-success-ink',      dot: 'bg-success' },
  attention: { ground: 'bg-attention-tint text-attention-ink', body: 'text-attention-ink',    dot: 'bg-attention' },
  neutral:   { ground: 'bg-fill text-surface-on',              body: 'text-surface-on-variant', dot: 'bg-surface-on' },
}

interface StatusBannerProps {
  tone: StatusTone
  title: string
  children?: ReactNode
  icon?: ReactNode
  live?: boolean
  className?: string
}

/** The status line: tinted ground, dot, bold state, plain next step. */
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
