'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { fmtTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { sortedPlan, nodeTypeFor, type PhaseNodeType } from '@/lib/phase/derive'
import { currentTripPhase, phaseStopLabel, precinctAtPhase, precinctLabel } from '@/lib/phase/trip-detail'
import { locationEvidenceForPhase, hasLocationEvidence } from '@/lib/phase/location-evidence'
import { PhaseTimelineItem, PHASE_ANCHOR_PREFIX } from './PhaseTimelineItem'
import { PhaseEvidence, nextTripStop } from './PhaseEvidence'
import { InTransitTimeline } from '@/components/domain/InTransitTimeline'
import { PhaseExceptionGroup } from './PhaseExceptionGroup'
import { ExceptionMapButton, hasExceptionMapEvidence } from './ExceptionMapButton'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { ExceptionEvidence, exceptionHasEvidence } from '@/components/domain/ExceptionEvidence'
import { PositionDisagreement } from '@/components/domain/PositionDisagreement'
import { LocationEvidenceSummary } from '@/components/domain/LocationEvidenceSummary'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { ChainReceiptTag } from '@/components/blockchain/ChainReceiptTag'
import { VerifyButton } from '@/components/blockchain/VerifyButton'
import { uniqueExceptionsById } from './exception-dedupe'

// Phase types the compact location verdict applies to. trip_creation has no fix fields
// worth reading and in_transit gets its own "Recorded location at arrival" section
// instead (with an explicit no-verdict line); a chip here would pre-empt that and
// imply a checked boundary that in-transit never has, see location-evidence.ts.
const LOCATION_SUMMARY_PHASE_TYPES: readonly PhaseDescriptor['phase_type'][] =
  ['activation', 'loading', 'departure', 'unloading', 'confirmation']

/** The row's compact verdict chip, or undefined for a phase type/state this summary does
 *  not cover. A `pending` node has not run yet, so there is nothing recorded to show.
 *  Also undefined whenever `hasLocationEvidence` is false: LoadingDetail/UnloadingDetail
 *  gate their own "Location at ..." section on that exact same check, so a row must never
 *  advertise a chip here for a section the opened card does not have. */
function evidenceSummaryFor(trip: Trip, phase: PhaseDescriptor, precincts: Precinct[], nodeType: PhaseNodeType): ReactNode {
  if (nodeType === 'pending' || !LOCATION_SUMMARY_PHASE_TYPES.includes(phase.phase_type)) return undefined
  const evidence = locationEvidenceForPhase(phase, precinctAtPhase(trip, phase, precincts))
  if (!hasLocationEvidence(evidence)) return undefined
  return <LocationEvidenceSummary evidence={evidence} />
}

// Chronological anchor for an exception in the timeline: the
// instant its own evidence was captured, when it has an artifact carrying one, rather
// than the millisecond the system happened to persist the row — falling back to the
// recorded time for an exception with no artifact attached. TripException itself
// carries no capture timestamp of its own, so this is the only place that time can
// come from.
function exceptionEventTime(exception: TripException, artifactsById: Map<string, EvidenceArtifactWithUrl>): string {
  const artifact = exception.supporting_artifact_id ? artifactsById.get(exception.supporting_artifact_id) : undefined
  return artifact?.captured_at ?? exception.created_at
}

/** Chronological, id-tie-broken order shared by a transit leg's journey markers and
 *  every phase's exception branch, so the two can never disagree about which came
 *  first. */
function sortExceptionsByEventTime(exceptions: TripException[], artifactsById: Map<string, EvidenceArtifactWithUrl>): TripException[] {
  return [...exceptions].sort((a, b) =>
    Date.parse(exceptionEventTime(a, artifactsById)) - Date.parse(exceptionEventTime(b, artifactsById)) || a.id.localeCompare(b.id))
}

interface Props {
  trip: Trip; precincts: Precinct[]; artifactsById: Map<string, EvidenceArtifactWithUrl>
  artifactLoading: boolean; artifactError: string | null; onRetryArtifacts: () => void
  onChanged: () => void; returnTo: string
  /** When the record on screen was last read from the server, not a trip timestamp. */
  lastUpdated: number | null
  onJump: () => void
  /** Opens the exception panel scoped to the phase whose compact control was selected. */
  onOpenExceptions?: (phaseId: string) => void
  /** A page-originated reveal request; local group state remains inside the group. */
  revealRequest?: { phaseId: string; requestId: number } | null
  /** The group reports that it has revealed itself before the page scrolls its container. */
  onRevealHandled?: (phaseId: string) => void
}
export function TripTimeline({ trip, precincts, returnTo, lastUpdated, onJump, onOpenExceptions, revealRequest, onRevealHandled, ...evidence }: Props) {
  const active = currentTripPhase(trip)
  const phases = sortedPlan(trip.phases)
  const phaseIds = new Set(phases.map(p => p.phase_event_id))
  // A polling merge can deliver conflicting copies of one record. Resolve that once,
  // before assigning records to a phase or the trip-level stream, so one ID has one
  // destination and cannot appear in both paths.
  const exceptionsById = uniqueExceptionsById(trip.exceptions)
  const activeTransit = active?.phase_type === 'in_transit' && trip.status !== 'closed' && trip.status !== 'cancelled'
    ? active
    : null
  const activeTransitExceptions = activeTransit
    ? exceptionsById.filter(exception => exception.phase_event_id === activeTransit.phase_event_id)
    : []
  const activeTransitOrigin = activeTransit ? precinctLabel(precinctAtPhase(trip, activeTransit, precincts)) : ''
  const activeTransitDestination = activeTransit ? precinctLabel(precincts.find(precinct => precinct.id === nextTripStop(trip, activeTransit)?.precinct_id)) : ''
  const tripNotes = exceptionsById.filter(e => !e.phase_event_id || !phaseIds.has(e.phase_event_id as typeof phases[number]['phase_event_id']))
  return <section aria-label="Trip timeline" className="mx-auto w-full max-w-4xl p-4 md:p-6">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold uppercase tracking-widest text-on-surf-v">Trip timeline</h2>
        {/* Reads the record's freshness, not a trip fact — an evidence view should always
            be able to say when what you are looking at was last read. */}
        {lastUpdated !== null && <p className="mt-1 text-[12px] tabular-nums text-on-surf-v">Record refreshed {fmtTime(new Date(lastUpdated).toISOString())}</p>}
      </div>
      {active && trip.status !== 'created' && <Button variant="secondary" size="sm" onClick={onJump}>Jump to current phase ↓</Button>}
    </div>
    {/* No space-y here: the rail has to run through the gap between rows, so each row
        owns its own bottom margin instead. */}
    <div>
      {activeTransit && <CurrentLegStrip
        phaseId={activeTransit.phase_event_id}
        originName={activeTransitOrigin}
        destinationName={activeTransitDestination}
        exceptionCount={activeTransitExceptions.length}
        onShow={onJump}
      />}
      {phases.map((phase, phaseIndex) => {
        const nodeType = nodeTypeFor(phase, active?.phase_event_id ?? null, trip.status)
        const exceptions = sortExceptionsByEventTime(exceptionsById.filter(e => e.phase_event_id === phase.phase_event_id), evidence.artifactsById)
        const receipt = trip.blockchain_receipts.find(r => r.id === phase.blockchain_receipt_id)
          ?? (phase.phase_type === 'trip_creation' ? trip.blockchain_receipts.find(r => r.receipt_type === 'journey_lock') : undefined)
        const verifiesEvidence = receipt?.receipt_type === 'pickup' || receipt?.receipt_type === 'delivery'
        const summary = [phase.parcel_count_origin !== null ? `${phase.parcel_count_origin} recorded at origin` : null, phase.seal_number ? `Seal ${phase.seal_number}` : null].filter(Boolean).join(' · ')
        const isLastPhase = phaseIndex === phases.length - 1
        const isTransit = phase.phase_type === 'in_transit'
        // The trip's own suppression rule for a phase whose card content should not
        // render at all: an unreached phase (`pending`), or the active gate on a
        // cancelled trip (cancel_trip leaves every row PENDING, so this is currently
        // unreachable via that path in practice, but kept as the same explicit guard
        // PhaseEvidence itself was gated on before task 9). The journey summary must
        // never show for a phase whose full evidence would not show either — showing
        // one without the other would just be a different way of overclaiming.
        const showEvidence = nodeType !== 'pending' && !(trip.status === 'cancelled' && nodeType === 'next')
        // The truck is on the road right now: the arrival evidence is the live part of
        // this page, so the card stays open with no toggle while driving. Completed legs
        // stay collapsed — a finished trip reads better compact. The journey itself never
        // depends on this: it is persistent content, visible either way.
        const driving = isTransit
          && active?.phase_event_id === phase.phase_event_id
          && trip.status !== 'created'
        const journey = isTransit && showEvidence
          ? <InTransitTimeline
              phase={phase}
              allPhases={trip.phases}
              originName={precinctLabel(precinctAtPhase(trip, phase, precincts))}
              destinationName={precinctLabel(precincts.find(p => p.id === nextTripStop(trip, phase)?.precinct_id))}
              exceptions={exceptions}
            />
          : undefined
        const exceptionBranch = exceptions.length > 0
          ? <PhaseExceptionGroup
              phaseId={phase.phase_event_id}
              phaseLabel={PHASE_NAMES[phase.phase_type]}
              exceptions={exceptions}
              isLast={isLastPhase}
              revealRequest={revealRequest}
              onRevealHandled={() => onRevealHandled?.(phase.phase_event_id)}
            >
              {exceptions.map(exception => {
                const precinct = precinctAtPhase(trip, phase, precincts)
                const mapEvidence = hasExceptionMapEvidence(exception, phase, precinct)
                const hasSupportingEvidence = exceptionHasEvidence(exception) || exception.exception_type === 'gps_mismatch'
                // A driver-raised gps_mismatch carrying its own action_location_assessment
                // shows genuinely different evidence in each place (ExceptionMapButton
                // reads the assessment; the panel below always reads the phase's own
                // fixes, per PositionDisagreement's "Linked phase locations" contract) —
                // only suppress the panel's inner button when the two are provably
                // showing the same phase-based evidence.
                const footer = (mapEvidence || hasSupportingEvidence) && <>
                  {mapEvidence && <ExceptionMapButton exception={exception} phase={phase} precinct={precinct} />}
                  {hasSupportingEvidence && <details className={mapEvidence ? 'mt-3 text-sm' : 'text-sm'}>
                    <summary className="cursor-pointer font-semibold text-sec">Supporting evidence</summary>
                    <div className="mt-3">
                      {exception.exception_type === 'gps_mismatch' && (
                        <PositionDisagreement phase={phase} precinct={precinct} source={exception.source} hideMapButton={!exception.action_location_assessment} />
                      )}
                      <ExceptionEvidence exception={exception} artifactsById={evidence.artifactsById} />
                    </div>
                  </details>}
                </>
                // The panel is the review surface: it scopes to this phase and keeps
                // every record, warnings included, whatever filter the reader last used.
                // Each card carries its own trigger (rather than one shared link below
                // the group) so "how do I see/review this" is never a second control to
                // hunt for once you already have the card in front of you.
                return <div key={exception.id} role="group" aria-label={`Exception linked to ${PHASE_NAMES[phase.phase_type]} phase`}>
                  <ExceptionSummary
                    exception={exception}
                    phaseLabel={PHASE_NAMES[phase.phase_type]}
                    returnTo={returnTo}
                    footer={footer || undefined}
                    onOpenPanel={onOpenExceptions ? () => onOpenExceptions(phase.phase_event_id) : undefined}
                  />
                </div>
              })}
            </PhaseExceptionGroup>
          : undefined
        return <div key={phase.phase_event_id} role="group" aria-label={`${PHASE_NAMES[phase.phase_type]} phase${exceptions.length ? ' and exceptions' : ''}`}>
          <PhaseTimelineItem id={`${PHASE_ANCHOR_PREFIX}${phase.phase_event_id}`} number={phase.sequence_number} label={PHASE_NAMES[phase.phase_type]} meta={phaseStopLabel(trip, phase, precincts)} summary={summary} timestamp={phase.completed_at} nodeType={nodeType}
            initialOpen={active?.phase_event_id === phase.phase_event_id && trip.status !== 'created'} cancelled={trip.status === 'cancelled'} overridden={phase.status === 'overridden'}
            isLast={isLastPhase && exceptions.length === 0} alwaysOpen={driving}
            evidenceSummary={evidenceSummaryFor(trip, phase, precincts, nodeType)}
            persistentContent={journey}
            warning={phase.anchor_status === 'failed' ? 'Anchor failed — receipt still owed' : undefined}
            receipt={receipt ? <ForensicOnly>
              <ChainReceiptTag receipt={receipt} />
              {verifiesEvidence && <VerifyButton
                subjectType="phase_event"
                subjectId={phase.phase_event_id}
                ariaLabel={`Verify integrity for ${PHASE_NAMES[phase.phase_type]} receipt, phase ${phase.sequence_number}`}
              />}
            </ForensicOnly> : undefined}>
            {showEvidence && <PhaseEvidence trip={trip} phase={phase} precincts={precincts} {...evidence} />}
          </PhaseTimelineItem>
          {exceptionBranch}
        </div>
      })}
      {tripNotes.length > 0 && <section aria-label="Trip-level events" className="space-y-3 border-t border-outline-v/30 pt-4"><h3 className="font-bold text-on-surf">Trip record</h3>{[...tripNotes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(exception => <ExceptionSummary key={exception.id} exception={exception} returnTo={returnTo} />)}</section>}
    </div>
  </section>
}

/** A small recovery control for a live leg that has been scrolled out of the timeline
 * scroller. It observes only that scroller (never the viewport) and never scrolls by
 * itself: movement remains an explicit dispatcher choice. */
function CurrentLegStrip({ phaseId, originName, destinationName, exceptionCount, onShow }: {
  phaseId: string; originName: string; destinationName: string; exceptionCount: number; onShow: () => void
}) {
  const [rowOutOfView, setRowOutOfView] = useState(false)

  useEffect(() => {
    const row = document.getElementById(`${PHASE_ANCHOR_PREFIX}${phaseId}`)
    const scroller = row?.closest<HTMLElement>('[data-timeline-scroller]')
    if (!row || !scroller || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setRowOutOfView(!entry.isIntersecting), { root: scroller, threshold: 0.15 })
    observer.observe(row)
    return () => observer.disconnect()
  }, [phaseId])

  if (!rowOutOfView) return null
  return <aside aria-label="Current transit leg" className="sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sec/30 bg-surf-lowest px-3 py-2 shadow-level-1">
    <p className="min-w-0 text-[14px] font-semibold text-on-surf">{originName} → En route to {destinationName}{exceptionCount ? ` · ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'}` : ''}</p>
    <Button variant="secondary" size="sm" onClick={onShow}>Show current leg</Button>
  </aside>
}
