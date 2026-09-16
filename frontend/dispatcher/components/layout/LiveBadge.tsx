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
}

export function LiveBadge({ compact = false }: LiveBadgeProps) {
  const status = useRealtimeStatus()
  const meta = STATUS_META[status]

  return (
    <div className="flex items-center gap-[6px]" role="status" aria-live="polite" title={meta.label}>
      <span className={cn('w-[7px] h-[7px] rounded-full shrink-0', meta.dot, meta.pulse && 'animate-pulse')} />
      <span className={cn('text-[10px] font-[600] tracking-[0.04em] text-white/50', compact && 'sr-only')}>
        {meta.label}
      </span>
    </div>
  )
}
