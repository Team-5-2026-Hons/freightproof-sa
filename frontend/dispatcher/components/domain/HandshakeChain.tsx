import { CheckCircle2, Clock, Circle, AlertCircle, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { HandshakeEvent } from '@shared/lib/types/handshake'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import type { HandshakeNumber, HandshakeStatus } from '@shared/lib/types/handshake'

interface HandshakeChainProps {
  handshakes: HandshakeEvent[]
  /** Compact mode shows fewer labels — used in table rows */
  compact?: boolean
  className?: string
}

const statusConfig: Record<HandshakeStatus, {
  icon: typeof CheckCircle2
  colorClass: string
  bgClass: string
  animated?: boolean
}> = {
  completed:   { icon: CheckCircle2,  colorClass: 'text-success',             bgClass: 'bg-success-container' },
  in_progress: { icon: Clock,         colorClass: 'text-tertiary-fixed-dim',  bgClass: 'bg-tertiary-container', animated: true },
  pending:     { icon: Circle,        colorClass: 'text-outline',             bgClass: 'bg-surface-container-highest' },
  exception:   { icon: AlertCircle,   colorClass: 'text-error',               bgClass: 'bg-error-container' },
  overridden:  { icon: ShieldAlert,   colorClass: 'text-secondary',           bgClass: 'bg-secondary-fixed' },
}

/**
 * Horizontal 6-node progress indicator showing handshakes 0–5.
 * Each node reflects the handshake status with the correct icon and colour.
 */
export function HandshakeChain({ handshakes, compact = false, className }: HandshakeChainProps) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-2', className)}>
      {handshakes.map((hs) => {
        const config = statusConfig[hs.status]
        const Icon = config.icon
        const label = HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]

        return (
          <div key={hs.id} className="flex items-center gap-1">
            {/* Connector line — not before the first node */}
            {hs.sequence_number > 0 && (
              <div
                className={cn(
                  'h-0.5 rounded-full',
                  compact ? 'w-3' : 'w-6',
                  hs.status === 'completed' || hs.status === 'overridden'
                    ? 'bg-success'
                    : 'bg-surface-dim',
                )}
              />
            )}

            {/* Node */}
            <div
              className={cn('flex items-center gap-1.5', !compact && 'flex-col')}
              title={label}
            >
              <span
                className={cn(
                  'flex items-center justify-center rounded-full',
                  compact ? 'w-5 h-5' : 'w-8 h-8',
                  config.bgClass,
                  config.animated && 'animate-pulse',
                )}
              >
                <Icon className={cn(config.colorClass, compact ? 'w-3 h-3' : 'w-4 h-4')} />
              </span>
              {!compact && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant whitespace-nowrap">
                  {label}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
