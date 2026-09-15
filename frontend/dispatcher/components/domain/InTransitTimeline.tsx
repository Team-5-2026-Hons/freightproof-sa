'use client'

import { Ic } from '@/components/ui/Ic'
import { Chip } from '@/components/ui/Chip'
import { ExceptionEvidence } from './ExceptionEvidence'
import { PhaseLocationSection } from './PhaseLocationSection'
import { hasAnyFix, locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  phase: PhaseDescriptor
  // Exceptions belonging to this leg. Placement is currently approximate — see the page.
  exceptions: TripException[]
  // This leg renders its exceptions in full rather than as bare labels, so it needs the
  // artifact map for the same reason the standalone exception cards do.
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

type MiniNode = {
  key: string
  kind: 'exception'
  label: string
  timestamp: string | null
  detail?: string
  // Carried whole, not flattened to a label — the panic button is exactly the type
  // most likely to carry a photo and a GPS fix.
  exception: TripException
}

/**
 * The expanded detail body for one in-transit leg: full per-exception evidence
 * (severity, source, review status, artifacts) plus the arrival-location section.
 *
 * Departure and arrival facts — "Departed X", "En route to Y", "Arrived Y" — live
 * ENTIRELY in `TransitJourneySummary` (task 9's `persistentContent`), which is visible
 * whether or not this body is expanded. This component must never repeat them: a
 * review round on this task caught exactly that duplication (an expanded, or
 * always-open driving, leg showing the same departure/arrival line twice), so there is
 * no departure/arrival rendering here at all, deliberately.
 *
 * Exception markers are likewise compact and outside disclosure in
 * `TransitJourneySummary` (timestamp, label, severity, a link to the panel — no
 * description, no artifacts, no full cards, per the plan's binding spec text). What
 * remains here is the genuinely-expanded-only detail: the full evidence for an
 * exception a dispatcher has chosen to look into, and the leg's own recorded
 * coordinates. `PhaseEvidence` passes `exceptions={[]}` today (no full card exists
 * yet to open into), so this scaffold is presently dormant rather than dead — it is
 * where that full per-exception detail belongs once something links into it.
 */
export function InTransitTimeline({
  phase, exceptions, artifactsById,
}: Props) {
  // undefined, not the destination precinct: this leg's stop is the ORIGIN it departed
  // from, so a boundary drawn from the destination would compare an arrival fix against
  // the wrong fence (see the brief's binding rule on in-transit). The stored verdict is
  // also never present here (verdictFor already reads in_transit as
  // 'no_verdict_for_phase' unless the backend stored one), which is the explicit absence
  // this section exists to show, not to fill in.
  const arrivalEvidence = locationEvidenceForPhase(phase, undefined)

  const nodes: MiniNode[] = exceptions.map((exc): MiniNode => ({
    key: exc.id,
    kind: 'exception',
    label: fmtExceptionType(exc.exception_type),
    timestamp: exc.created_at,
    detail: exc.description,
    exception: exc,
  }))

  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20">
      {nodes.length > 0 && <>
        <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[8px]">
          Journey
        </div>

        {nodes.map((node, i) => (
          <div key={node.key} className="flex gap-[10px]">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-[8px] h-[8px] rounded-full mt-[5px] bg-warn" />
              {i < nodes.length - 1 && <div className="w-0.5 flex-1 min-h-[16px] my-[3px] bg-outline-v/30" />}
            </div>

            <div className="flex-1 pb-[8px] min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-[600] text-warn-onc">
                  {node.label}
                </span>
                <span className="text-[11px] font-[600] text-sec tabular-nums shrink-0">
                  {fmtDateTime(node.timestamp)}
                </span>
              </div>

              {/* Parity with a standalone exception card. Without these, an exception
                  that happened to fall on a transit leg silently lost its severity, its
                  source and every artifact the driver captured — while the identical
                  exception on any other phase kept all three. */}
              <div className="flex items-center gap-[6px] mt-[3px]">
                <Chip
                  type={EXCEPTION_SEVERITY_META[node.exception.severity].chipType}
                  label={EXCEPTION_SEVERITY_META[node.exception.severity].label}
                />
                <span className="text-[10px] font-[500] text-on-surf-v">
                  {EXCEPTION_SOURCE_META[node.exception.source].label}
                </span>
              </div>

              {node.detail && (
                <div className="text-[11px] text-on-surf-v mt-[2px]">{node.detail}</div>
              )}

              {node.exception.review_status === 'reviewed' && (
                <div className="text-[11px] text-ok mt-[3px] flex items-center gap-[4px]">
                  <Ic n="check" s={11} className="text-ok" />
                  {node.exception.review_note
                    ? `Resolved · ${node.exception.review_note}`
                    : 'Resolved'}
                </div>
              )}

              <ExceptionEvidence exception={node.exception} artifactsById={artifactsById} />
            </div>
          </div>
        ))}
      </>}

      {/* Named absence. Without this the card silently implies nothing happened en
          route. Deliberately generic rather than naming a specific integration
          (Pulsit, weighbridges, checkpoints): this line must never read as a promise
          that a continuous live route exists, or that any particular future source is
          about to fill the gap — only that nothing beyond what was actually recorded
          is being claimed here. */}
      <div className="flex items-center gap-[6px] text-[10px] text-on-surf-v mt-[2px]">
        <Ic n="clock" s={10} className="text-on-surf-v" />
        Only recorded journey events are shown.
      </div>

      {/* precinct is deliberately undefined (see arrivalEvidence above): no boundary is
          ever drawn for a transit leg. The verdict line reads "No geofence verdict is
          recorded for transit legs", which is the required explicit absence: a fix may
          exist, but nothing here is allowed to imply it was checked against a fence. */}
      {hasAnyFix(arrivalEvidence) && (
        <PhaseLocationSection phase={phase} precinct={undefined} title="Recorded location at arrival" />
      )}
    </div>
  )
}
