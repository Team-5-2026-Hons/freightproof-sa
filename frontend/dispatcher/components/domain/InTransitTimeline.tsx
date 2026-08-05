'use client'

import { Ic } from '@/components/ui/Ic'
import { Chip } from '@/components/ui/Chip'
import { ExceptionEvidence } from './ExceptionEvidence'
import { legDepartureAt } from '@/lib/phase/derive'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  phase: PhaseDescriptor
  // Needed to date this leg from its OWN departure — see legDepartureAt. The in-transit
  // row cannot date itself: its created_at is plan-generation time, not departure time.
  allPhases: readonly PhaseDescriptor[]
  // Exceptions belonging to this leg. Placement is currently approximate — see the page.
  exceptions: TripException[]
  // This leg renders its exceptions in full rather than as bare labels, so it needs the
  // artifact map for the same reason the standalone exception cards do.
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  originName: string
  destinationName: string
}

type MiniNode = {
  key: string
  kind: 'departed' | 'exception' | 'arrived' | 'awaiting'
  label: string
  timestamp: string | null
  detail?: string
  // Carried whole on exception nodes, not flattened to a label. This leg is the ONLY
  // place an en-route exception is rendered — the page deliberately stops emitting a
  // duplicate card below — so anything dropped here is dropped everywhere, and the
  // panic button is exactly the type most likely to carry a photo and a GPS fix.
  exception?: TripException
}

/**
 * The journey between two stops, always expanded.
 *
 * Two provable nodes today: departure (this leg's creation) and arrival (its completion).
 * Weighbridges, driver and vehicle substitutions and periodic checkpoints are all
 * Pulsit- or checkpoint-sourced; `checkpoints` is write-only and Pulsit is not integrated,
 * so they are absent rather than faked. The node list is built to extend.
 */
export function InTransitTimeline({
  phase, allPhases, exceptions, artifactsById, originName, destinationName,
}: Props) {
  const departedAt = legDepartureAt(allPhases, phase)

  // Built in three cases rather than two nested ternaries, because "not yet departed" is
  // a real third state: the truck is still at origin, so it is neither departed NOR en
  // route, and claiming either would be the same class of lie as dating the departure
  // from plan-generation time.
  const nodes: MiniNode[] = []

  if (departedAt === null) {
    nodes.push({
      key: 'awaiting-departure',
      kind: 'awaiting',
      label: `Awaiting departure from ${originName}`,
      timestamp: null,
    })
  } else {
    nodes.push({
      key: 'departed',
      kind: 'departed',
      label: `Departed ${originName}`,
      timestamp: departedAt,
    })
  }

  nodes.push(...exceptions.map((exc): MiniNode => ({
    key: exc.id,
    kind: 'exception',
    label: fmtExceptionType(exc.exception_type),
    timestamp: exc.created_at,
    detail: exc.description,
    exception: exc,
  })))

  if (phase.completed_at) {
    nodes.push({
      key: 'arrived',
      kind: 'arrived',
      label: `Arrived ${destinationName}`,
      timestamp: phase.completed_at,
    })
  } else if (departedAt !== null) {
    nodes.push({
      key: 'awaiting',
      kind: 'awaiting',
      label: `En route to ${destinationName}`,
      timestamp: null,
    })
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

            {/* Parity with a standalone exception card. Without these, an exception that
                happened to fall on a transit leg silently lost its severity, its source
                and every artifact the driver captured — while the identical exception on
                any other phase kept all three. */}
            {node.exception && (
              <div className="flex items-center gap-[6px] mt-[3px]">
                <Chip
                  type={EXCEPTION_SEVERITY_META[node.exception.severity].chipType}
                  label={EXCEPTION_SEVERITY_META[node.exception.severity].label}
                />
                <span className="text-[10px] font-[500] text-on-surf-v">
                  {EXCEPTION_SOURCE_META[node.exception.source].label}
                </span>
              </div>
            )}

            {node.detail && (
              <div className="text-[11px] text-on-surf-v mt-[2px]">{node.detail}</div>
            )}

            {node.exception?.resolved && (
              <div className="text-[11px] text-ok mt-[3px] flex items-center gap-[4px]">
                <Ic n="check" s={11} className="text-ok" />
                {node.exception.resolver_note
                  ? `Resolved · ${node.exception.resolver_note}`
                  : 'Resolved'}
              </div>
            )}

            {node.exception && (
              <ExceptionEvidence exception={node.exception} artifactsById={artifactsById} />
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
