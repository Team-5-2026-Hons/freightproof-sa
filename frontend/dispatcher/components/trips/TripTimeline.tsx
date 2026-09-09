'use client'

import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { fmtTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { sortedPlan, nodeTypeFor } from '@/lib/phase/derive'
import { currentTripPhase, phaseStopLabel } from '@/lib/phase/trip-detail'
import { PhaseTimelineItem } from './PhaseTimelineItem'
import { PhaseEvidence } from './PhaseEvidence'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { ExceptionEvidence, exceptionHasEvidence } from '@/components/domain/ExceptionEvidence'
import { PositionDisagreement } from '@/components/domain/PositionDisagreement'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { ChainReceiptTag } from '@/components/blockchain/ChainReceiptTag'

interface Props {
  trip: Trip; precincts: Precinct[]; artifactsById: Map<string, EvidenceArtifactWithUrl>
  artifactLoading: boolean; artifactError: string | null; onRetryArtifacts: () => void
  onChanged: () => void; returnTo: string
  /** When the record on screen was last read from the server, not a trip timestamp. */
  lastUpdated: number | null
  onJump: () => void
}
export function TripTimeline({ trip, precincts, returnTo, lastUpdated, onJump, ...evidence }: Props) {
  const active = currentTripPhase(trip)
  const phases = sortedPlan(trip.phases)
  const phaseIds = new Set(phases.map(p => p.phase_event_id))
  const tripNotes = trip.exceptions.filter(e => !e.phase_event_id || !phaseIds.has(e.phase_event_id as typeof phases[number]['phase_event_id']))
  return <section aria-label="Trip timeline" className="mx-auto w-full max-w-4xl p-4 md:p-6">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold uppercase tracking-widest text-on-surf-v">Trip timeline</h2>
        {/* Reads the record's freshness, not a trip fact — an evidence view should always
            be able to say when what you are looking at was last read. */}
        {lastUpdated !== null && <p className="mt-1 text-[11px] tabular-nums text-on-surf-v">Updated {fmtTime(new Date(lastUpdated).toISOString())}</p>}
      </div>
      {active && trip.status !== 'created' && <Button variant="secondary" size="sm" onClick={onJump}>Jump to current phase ↓</Button>}
    </div>
    {/* No space-y here: the rail has to run through the gap between rows, so each row
        owns its own bottom margin instead. */}
    <div>
      {phases.map((phase, phaseIndex) => {
        const nodeType = nodeTypeFor(phase, active?.phase_event_id ?? null, trip.status)
        const exceptions = trip.exceptions.filter(e => e.phase_event_id === phase.phase_event_id)
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
        const receipt = trip.blockchain_receipts.find(r => r.id === phase.blockchain_receipt_id)
          ?? (phase.phase_type === 'trip_creation' ? trip.blockchain_receipts.find(r => r.receipt_type === 'journey_lock') : undefined)
        const summary = [phase.parcel_count_origin !== null ? `${phase.parcel_count_origin} recorded at origin` : null, phase.seal_number ? `Seal ${phase.seal_number}` : null].filter(Boolean).join(' · ')
        const isLastPhase = phaseIndex === phases.length - 1
        // The truck is on the road right now: the journey mini-timeline is the live part
        // of this page, and a dispatcher should not have to open it to watch a drive.
        // Completed legs stay collapsed — a finished trip reads better compact.
        const driving = phase.phase_type === 'in_transit'
          && active?.phase_event_id === phase.phase_event_id
          && trip.status !== 'created'
        return <div key={phase.phase_event_id} role="group" aria-label={`${PHASE_NAMES[phase.phase_type]} phase${exceptions.length ? ' and exceptions' : ''}`}>
          <PhaseTimelineItem id={`phase-${phase.phase_event_id}`} number={phase.sequence_number} label={PHASE_NAMES[phase.phase_type]} meta={phaseStopLabel(trip, phase, precincts)} summary={summary} timestamp={phase.completed_at} nodeType={nodeType}
            initialOpen={active?.phase_event_id === phase.phase_event_id && trip.status !== 'created'} cancelled={trip.status === 'cancelled'} overridden={phase.status === 'overridden'}
            isLast={isLastPhase && exceptions.length === 0} alwaysOpen={driving}
            warning={phase.anchor_status === 'failed' ? 'Anchor failed — receipt still owed' : undefined}
            receipt={receipt ? <ForensicOnly><ChainReceiptTag receipt={receipt} /></ForensicOnly> : undefined}>
            {nodeType !== 'pending' && !(trip.status === 'cancelled' && nodeType === 'next') && <PhaseEvidence trip={trip} phase={phase} precincts={precincts} {...evidence} />}
          </PhaseTimelineItem>
          {exceptions.map((exception, exceptionIndex) => {
            const isLastRow = isLastPhase && exceptionIndex === exceptions.length - 1
            return <div key={exception.id} role="group" aria-label={`Exception linked to ${PHASE_NAMES[phase.phase_type]} phase`} data-timeline-kind="exception" className="relative flex min-w-0 gap-[14px]">
              {/* A branch off the phase card, not another phase on the journey rail: the
                  stem leaves the rail and a smaller diamond node lands the exception in
                  the same chronology without promoting it to a step of the trip. */}
              <div className="relative w-[54px] shrink-0" aria-hidden="true">
                <div className={`absolute left-[14px] top-0 w-0.5 bg-outline-v/30 ${isLastRow ? 'h-[15px]' : 'bottom-0'}`} />
                <div className="absolute left-[15px] top-[14px] h-px w-[31px] bg-outline-v/50" />
                <div className="absolute left-[38px] top-[6px] flex h-[17px] w-[17px] rotate-45 items-center justify-center rounded-[3px] border border-warn-c bg-warn-c text-warn-onc ring-[3px] ring-surf-lowest">
                  <span className="-rotate-45 font-mono text-[9px] font-[800] leading-none">{exceptionIndex + 1}</span>
                </div>
              </div>
              <div className="mb-3 min-w-0 flex-1">
                <ExceptionSummary exception={exception} phaseLabel={PHASE_NAMES[phase.phase_type]} returnTo={returnTo} />
                {(exceptionHasEvidence(exception) || exception.exception_type === 'gps_mismatch') && <details className="rounded-b-lg bg-surf-low px-4 pb-3 text-sm">
                  <summary className="cursor-pointer py-3 font-semibold text-sec">Supporting evidence</summary>
                  {exception.exception_type === 'gps_mismatch' && <PositionDisagreement phase={phase} />}
                  <ExceptionEvidence exception={exception} artifactsById={evidence.artifactsById} />
                </details>}
              </div>
            </div>
          })}
        </div>
      })}
      {tripNotes.length > 0 && <section aria-label="Trip-level events" className="space-y-3 border-t border-outline-v/30 pt-4"><h3 className="font-bold text-on-surf">Trip record</h3>{[...tripNotes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(exception => <ExceptionSummary key={exception.id} exception={exception} returnTo={returnTo} />)}</section>}
    </div>
  </section>
}
