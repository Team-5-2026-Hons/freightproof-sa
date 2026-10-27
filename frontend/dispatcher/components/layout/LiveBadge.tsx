'use client'

import { cn } from '@shared/lib/utils/cn'
import { useRealtimeStatus } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeStatus } from '@/lib/realtime/types'

const STATUS_META: Record<RealtimeStatus, { label: string; detail: string; dot: string; pulse: boolean }> = {
  live:         { label: 'Live',            detail: 'Live updates connected',        dot: 'bg-ok',        pulse: true },
  connecting:   { label: 'Connecting…',     detail: 'Connecting to live updates',    dot: 'bg-white/40',  pulse: false },
  reconnecting: { label: 'Reconnecting…',   detail: 'Reconnecting to live updates',  dot: 'bg-warn',      pulse: false },
}

interface LiveBadgeProps {
  compact?: boolean
  className?: string
}

export function LiveBadge({ compact = false, className }: LiveBadgeProps) {
  const status = useRealtimeStatus()
  const meta = STATUS_META[status]

  return (
    <div className={cn('flex items-center gap-[6px]', className)} role="status" aria-live="polite" title={meta.detail}>
      <span className={cn(
        'rounded-full shrink-0',
        compact ? 'w-[10px] h-[10px] ring-2 ring-primary' : 'w-[7px] h-[7px]',
        meta.dot,
        meta.pulse && 'animate-pulse',
      )} />
      {!compact && <span aria-hidden="true" className="text-[11px] font-[500] text-white/50">{meta.label}</span>}
      <span className="sr-only">{meta.detail}</span>
    </div>
  )
}
