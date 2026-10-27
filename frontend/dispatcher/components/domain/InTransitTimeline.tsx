'use client'

import { Ic } from '@/components/ui/Ic'
import { Chip } from '@/components/ui/Chip'
import { PhaseLocationSection } from './PhaseLocationSection'
import { legDepartureAt } from '@/lib/phase/derive'
import { hasAnyFix, locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  phase: PhaseDescriptor
  allPhases: readonly PhaseDescriptor[]
  exceptions: readonly TripException[]
  originName: string
  destinationName: string
}

type MiniNode = {
  key: string
  kind: 'departed' | 'exception' | 'arrived' | 'awaiting'
  label: string
  timestamp: string | null
  exception?: TripException
}

/**
 * The journey between two stops, rendered outside the phase card's disclosure so a
 * dispatcher never has to open a leg to see whether the truck has departed, what
 * happened en route, and whether it has arrived.
 *
 * Two provable movement nodes today: departure (the preceding departure phase's
 * completion) and arrival (this leg's completion). Weighbridges, driver and vehicle
 * substitutions and periodic checkpoints are all Pulsit- or checkpoint-sourced and are
 * absent rather than faked. The node list is built to extend.
 */
export function InTransitTimeline({ phase, allPhases, exceptions, originName, destinationName }: Props) {
  const departedAt = legDepartureAt(allPhases, phase)

  const nodes: MiniNode[] = []

  if (departedAt === null) {
    nodes.push({ key: 'awaiting-departure', kind: 'awaiting', label: `Awaiting departure from ${originName}`, timestamp: null })
  } else {
    nodes.push({ key: 'departed', kind: 'departed', label: `Departed ${originName}`, timestamp: departedAt })
  }

  nodes.push(...exceptions.map((exc): MiniNode => ({
    key: exc.id,
    kind: 'exception',
    label: fmtExceptionType(exc.exception_type),
    timestamp: exc.created_at,
    exception: exc,
  })))

  if (phase.completed_at && phase.status !== 'overridden') {
    nodes.push({ key: 'arrived', kind: 'arrived', label: `Arrived ${destinationName}`, timestamp: phase.completed_at })
  } else if (departedAt !== null) {
    nodes.push({ key: 'awaiting', kind: 'awaiting', label: `En route to ${destinationName}`, timestamp: null })
  }

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
        <div key={node.key} className="flex gap-[10px]" data-testid={node.kind === 'exception' ? 'transit-exception-marker' : undefined}>
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-[8px] h-[8px] rounded-full mt-[5px] ${dotStyle[node.kind]}`} />
            {i < nodes.length - 1 && <div className="w-0.5 flex-1 min-h-[16px] my-[3px] bg-outline-v/30" />}
          </div>

          <div className="flex-1 pb-[8px] min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`flex min-w-0 flex-wrap items-center gap-[6px] text-[12px] font-[600] ${
                node.kind === 'exception' ? 'text-warn-onc' : 'text-on-surf'
              }`}>
                {node.label}
                {node.exception && <Chip
                  type={EXCEPTION_SEVERITY_META[node.exception.severity].chipType}
                  label={EXCEPTION_SEVERITY_META[node.exception.severity].label}
                />}
              </span>
              <span className="text-[11px] font-[600] text-sec tabular-nums shrink-0">
                {fmtDateTime(node.timestamp)}
              </span>
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-[6px] text-[10px] text-on-surf-v mt-[2px]">
        <Ic n="clock" s={10} className="text-on-surf-v" />
        Only recorded journey events are shown.
      </div>
    </div>
  )
}

/**
 * The leg's own recorded coordinates at arrival, kept inside the card's disclosure:
 * full fixes are detail, not the at-a-glance journey above.
 *
 * precinct is deliberately undefined: this leg's stop is the ORIGIN it departed from,
 * so a boundary drawn from the destination would compare an arrival fix against the
 * wrong fence (see the brief's binding rule on in-transit). The verdict line reads
 * "No geofence verdict is recorded for transit legs" — a fix may exist, but nothing
 * here is allowed to imply it was checked against a fence.
 */
export function InTransitArrivalLocation({ phase }: { phase: PhaseDescriptor }) {
  const arrivalEvidence = locationEvidenceForPhase(phase, undefined)
  if (!hasAnyFix(arrivalEvidence)) return null
  return <PhaseLocationSection phase={phase} precinct={undefined} title="Recorded location at arrival" />
}
