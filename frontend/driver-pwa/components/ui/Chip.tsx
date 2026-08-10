import { type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type ChipKind = 'verified' | 'success' | 'warning' | 'error' | 'pending' | 'neutral' | 'overridden' | 'info' | 'live'

const chipVariants = cva('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider', {
  variants: {
    kind: {
      verified:   'bg-secondary/10 text-secondary',
      info:       'bg-secondary/10 text-secondary',
      success:    'bg-success-container text-success-on-container',
      warning:    'bg-tertiary-container text-tertiary-on-container',
      error:      'bg-error-container text-error-on-container',
      pending:    'bg-surface-container-highest text-surface-on-variant',
      neutral:    'bg-surface-container-highest text-surface-on',
      overridden: 'bg-secondary-fixed text-secondary-on-container',
      // The only solid-fill chip in the set, and deliberately so: `live` marks the
      // one trip a driver is actually running right now, and it competes on-screen
      // with `success` (a *closed* trip), which already owns the pale green
      // container. Same success hue, inverted weight — so "running now" and
      // "finished" can never be mistaken for each other at a glance.
      live:       'bg-success text-success-on',
    } satisfies Record<ChipKind, string>,
  },
})

interface ChipProps extends VariantProps<typeof chipVariants> {
  kind: ChipKind
  icon?: ReactNode
  children: ReactNode
  animated?: boolean
  className?: string
  // Native title tooltip — used by AnchorBadge to surface a full event hash on hover
  // without cluttering the compact pill label itself.
  title?: string
}

// The `live` beacon: a steady dot with a ring pulsing out of it, mirroring
// GpsCapture's own radar treatment for an active fix. Chosen over blinking the dot
// itself — an on/off blink at chip scale reads as a rendering glitch, whereas an
// expanding ring reads as "this is transmitting", which is exactly what an active
// trip is. motion-reduce disables it (globals.css also caps every animation under
// prefers-reduced-motion; this keeps the intent explicit at the call site).
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-current animate-radar-pulse motion-reduce:animate-none" />
      <span className="relative h-2 w-2 rounded-full bg-current" />
    </span>
  )
}

export function Chip({ kind, icon, children, animated = false, className, title }: ChipProps) {
  return (
    <span title={title} className={cn(chipVariants({ kind }), className)}>
      {/* `live` animates by design, not by call-site opt-in: every surface that shows a
          running trip must pulse identically, and leaving that to each caller passing
          `animated` is how one screen ends up silently static. */}
      {icon ?? (kind === 'live' ? (
        <LiveDot />
      ) : (
        <span className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-70', animated && 'animate-pulse')} />
      ))}
      {children}
    </span>
  )
}
