import { CheckCircle2, Clock, Circle, AlertCircle, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { PhaseStatus } from '@shared/lib/types/phase'
import type { PhaseChainNode } from '@/lib/phase/derive'

interface PhaseChainProps {
  /** Already in plan order. Length is DATA — 7 nodes on a single-leg trip, 11 on a
   *  cross-dock one, and this component must never assume either. */
  nodes: readonly PhaseChainNode[]
  /** Compact mode renders dots instead of icons — used in table rows, where an
   *  11-node chain would otherwise overflow the 300px PROGRESS column. */
  compact?: boolean
  className?: string
}

const statusConfig: Record<PhaseStatus, {
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
 * Horizontal progress indicator over a trip's committed phase plan.
 *
 * Replaces a fixed 6-node progress indicator whose labels were indexed by
 * sequence_number into a fixed-length Record. The plan's length is data:
 * nothing here counts.
 */
export function PhaseChain({ nodes, compact = false, className }: PhaseChainProps) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-2', className)}>
      {nodes.map((node, index) => {
        const config = statusConfig[node.status]
        const Icon = config.icon
        const isDone = node.status === 'completed' || node.status === 'overridden'

        return (
          <div key={node.key} className="flex items-center gap-1">
            {/* Connector — not before the first node. Keyed off array index, not
                sequence_number: a plan is contiguous but need not start at 0 if a
                caller ever renders a slice. */}
            {index > 0 && (
              <div
                className={cn(
                  'h-0.5 rounded-full',
                  compact ? 'w-2' : 'w-6',
                  isDone ? 'bg-success' : 'bg-surface-dim',
                )}
              />
            )}

            <div className={cn('flex items-center gap-1.5', !compact && 'flex-col')} title={node.label}>
              {compact ? (
                // A dot, not an icon: 11 nodes at icon size overflow the PROGRESS
                // column. ChecklistRow prints the literal completed/total alongside,
                // so the count survives even if the chain is ever clipped.
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    config.bgClass,
                    config.animated && 'animate-pulse',
                  )}
                />
              ) : (
                <>
                  <span
                    className={cn(
                      'flex items-center justify-center rounded-full w-8 h-8',
                      config.bgClass,
                      config.animated && 'animate-pulse',
                    )}
                  >
                    <Icon className={cn(config.colorClass, 'w-4 h-4')} />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant whitespace-nowrap">
                    {node.label}
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
