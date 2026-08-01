'use client'

import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  phase: PhaseDescriptor
  // Exceptions belonging to this leg. Placement is currently approximate — see the page.
  exceptions: TripException[]
  originName: string
  destinationName: string
}

type MiniNode = {
  key: string
  kind: 'departed' | 'exception' | 'arrived' | 'awaiting'
  label: string
  timestamp: string | null
  detail?: string
}

/**
 * The journey between two stops, always expanded.
 *
 * Two provable nodes today: departure (this leg's creation) and arrival (its completion).
 * Weighbridges, driver and vehicle substitutions and periodic checkpoints are all
 * Pulsit- or checkpoint-sourced; `checkpoints` is write-only and Pulsit is not integrated,
 * so they are absent rather than faked. The node list is built to extend.
 */
export function InTransitTimeline({ phase, exceptions, originName, destinationName }: Props) {
  const nodes: MiniNode[] = [
    {
      key: 'departed',
      kind: 'departed',
      label: `Departed ${originName}`,
      timestamp: phase.created_at,
    },
    ...exceptions.map(exc => ({
      key: exc.id,
      kind: 'exception' as const,
      label: exc.exception_type.replace(/_/g, ' '),
      timestamp: exc.created_at,
      detail: exc.description,
    })),
    phase.completed_at
      ? {
          key: 'arrived',
          kind: 'arrived' as const,
          label: `Arrived ${destinationName}`,
          timestamp: phase.completed_at,
        }
      : {
          key: 'awaiting',
          kind: 'awaiting' as const,
          label: `En route to ${destinationName}`,
          timestamp: null,
        },
  ]

  const dotStyle: Record<MiniNode['kind'], string> = {
    departed:  'bg-ok',
    exception: 'bg-warn',
    arrived:   'bg-ok',
    awaiting:  'bg-sec animate-pulse',
  }

  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20">
      <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[8px]">
        Journey
      </div>

      {nodes.map((node, i) => (
        <div key={node.key} className="flex gap-[10px]">
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-[8px] h-[8px] rounded-full mt-[5px] ${dotStyle[node.kind]}`} />
            {i < nodes.length - 1 && <div className="w-0.5 flex-1 min-h-[16px] my-[3px] bg-outline-v/30" />}
          </div>

          <div className="flex-1 pb-[8px] min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-[12px] font-[600] ${
                node.kind === 'exception' ? 'text-warn-onc' : 'text-on-surf'
              }`}>
                {node.label}
              </span>
              <span className="text-[11px] font-[600] text-sec tabular-nums shrink-0">
                {fmtDateTime(node.timestamp)}
              </span>
            </div>
            {node.detail && (
              <div className="text-[11px] text-on-surf-v mt-[2px]">{node.detail}</div>
            )}
          </div>
        </div>
      ))}

      {/* Named absence. Without this the card silently implies nothing happened en route. */}
      <div className="flex items-center gap-[6px] text-[10px] text-on-surf-v mt-[2px]">
        <Ic n="clock" s={10} className="text-on-surf-v" />
        Weighbridges, driver and vehicle changes await the Pulsit integration.
      </div>
    </div>
  )
}
