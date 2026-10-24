'use client'

import { cn } from '@shared/lib/utils/cn'
import { useRealtimeStatus } from '@/lib/realtime/RealtimeProvider'
import type { RealtimeStatus } from '@/lib/realtime/types'

// Sits on the dark sidebar, so colours are tuned for that surface. `label` is the short text on
// screen; `detail` is the precise wording for the tooltip and screen readers. The badge reports the
// realtime stream only, so `detail` says "live updates" rather than letting "Live" read as "the data
// on screen is current": a data request can fail while the stream stays up (those screens say so).
const STATUS_META: Record<RealtimeStatus, { label: string; detail: string; dot: string; pulse: boolean }> = {
  live:         { label: 'Live',            detail: 'Live updates connected',        dot: 'bg-ok',        pulse: true },
  connecting:   { label: 'Connecting…',     detail: 'Connecting to live updates',    dot: 'bg-white/40',  pulse: false },
  reconnecting: { label: 'Reconnecting…',   detail: 'Reconnecting to live updates',  dot: 'bg-warn',      pulse: false },
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
    <div className={cn('flex items-center gap-[6px]', className)} role="status" aria-live="polite" title={meta.detail}>
      {/* The ring matches the sidebar surface so a dot overlaid on an avatar reads as
          cut out of it rather than bleeding into it. */}
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
