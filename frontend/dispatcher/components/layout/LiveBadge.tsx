'use client'

import { cn } from '@shared/lib/utils/cn'
import { useRealtimeStatus } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeStatus } from '@/lib/realtime/types'

// Sits on the dark sidebar, so colours are tuned for that surface.
const STATUS_META: Record<RealtimeStatus, { label: string; dot: string; pulse: boolean }> = {
  live:         { label: 'Live',            dot: 'bg-ok',        pulse: true },
  connecting:   { label: 'Connecting…',     dot: 'bg-white/40',  pulse: false },
  reconnecting: { label: 'Reconnecting…',   dot: 'bg-warn',      pulse: false },
}

interface LiveBadgeProps {
  /** Hides the text label visually (kept for screen readers) — used in the collapsed sidebar rail. */
  compact?: boolean
  /** Positioning from the caller, e.g. overlaying the dot on an avatar. */
  className?: string
}

export function LiveBadge({ compact = false, className }: LiveBadgeProps) {
  const status = useRealtimeStatus()
  const meta = STATUS_META[status]

  return (
    <div className={cn('flex items-center gap-[6px]', className)} role="status" aria-live="polite" title={meta.label}>
      {/* The ring matches the sidebar surface so a dot overlaid on an avatar reads as
          cut out of it rather than bleeding into it. */}
      <span className={cn(
        'rounded-full shrink-0',
        compact ? 'w-[10px] h-[10px] ring-2 ring-primary' : 'w-[7px] h-[7px]',
        meta.dot,
        meta.pulse && 'animate-pulse',
      )} />
      <span className={cn('text-[11px] font-[500] text-white/50', compact && 'sr-only')}>
        {meta.label}
      </span>
    </div>
  )
}
