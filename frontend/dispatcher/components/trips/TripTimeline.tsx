'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import { fmtTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { ExceptionRow, type OpenException } from '@/components/domain/ExceptionRow'
import { useNow } from '@/lib/hooks/useNow'
import { sortedPlan } from '@/lib/phase/derive'
import { exceptionEventTime } from '@/lib/phase/acts'
import { currentTripPhase, precinctAtPhase, precinctLabel } from '@/lib/phase/trip-detail'
import { PHASE_ANCHOR_PREFIX } from './PhaseTimelineItem'
import { nextTripStop } from './PhaseEvidence'
import { TimelinePhase } from './TimelinePhase'
import { uniqueExceptionsById } from './exception-dedupe'
import { useExceptionReveal, type RevealRequest } from './useExceptionReveal'

// "Time on the road" counts whole minutes, so one tick a minute keeps it honest without a
// timer per card.
const CLOCK_TICK_MS = 60_000
const NO_OPEN: OpenException = () => undefined

/** Chronological, id-tie-broken order shared by every phase's exception rows, so the rail and the
 *  rows can never disagree about which came first. */
function sortExceptionsByEventTime(exceptions: TripException[], artifactsById: Map<string, EvidenceArtifactWithUrl>): TripException[] {
  return [...exceptions].sort((a, b) =>
    Date.parse(exceptionEventTime(a, artifactsById)) - Date.parse(exceptionEventTime(b, artifactsById)) || a.id.localeCompare(b.id))
}

interface Props {
  trip: Trip; precincts: Precinct[]; artifactsById: Map<string, EvidenceArtifactWithUrl>
  artifactLoading: boolean; artifactError: string | null; onRetryArtifacts: () => void
  onChanged: () => void
  /** When the record on screen was last read from the server, not a trip timestamp. */
  lastUpdated: number | null
  onJump: () => void
  /** An exception row was activated. A null id opens the panel on the phase's records ("+n more");
   *  a null phase is a trip-level exception (D42). */
  onOpenException?: OpenException
  /** The exception the panel is open on, so its row can show the same selected state. */
  selectedExceptionId?: string | null
  /** A page-originated "Show in timeline": open the card, keep the row visible, land on it. */
  revealRequest?: RevealRequest | null
  /** Called with the revealed row's element id once it has focus, so the page can scroll its container. */
  onRevealHandled?: (targetId: string) => void
}

export function TripTimeline({
  trip, precincts, lastUpdated, onJump, onOpenException = NO_OPEN, selectedExceptionId = null, revealRequest, onRevealHandled, ...evidence
}: Props) {
  const active = currentTripPhase(trip)
  const phases = sortedPlan(trip.phases)
  const phaseIds = new Set(phases.map(p => p.phase_event_id))
  const now = useNow(CLOCK_TICK_MS)
  const { highlightedId } = useExceptionReveal(revealRequest, onRevealHandled)
  const artifacts = useMemo(() => [...evidence.artifactsById.values()], [evidence.artifactsById])
  const lookup = {
    artifactsById: evidence.artifactsById,
    artifactLoading: evidence.artifactLoading,
    artifactError: evidence.artifactError,
    onRetryArtifacts: evidence.onRetryArtifacts,
  }
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
  const tripNotes = sortExceptionsByEventTime(
    exceptionsById.filter(e => !e.phase_event_id || !phaseIds.has(e.phase_event_id as typeof phases[number]['phase_event_id'])),
    evidence.artifactsById,
  )
  return <section aria-label="Trip timeline" className="mx-auto w-full max-w-4xl p-4 md:p-6">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-body font-bold uppercase tracking-widest text-on-surf-v">Trip timeline</h2>
        {/* Reads the record's freshness, not a trip fact — an evidence view should always
            be able to say when what you are looking at was last read. */}
        {lastUpdated !== null && <p className="mt-1 text-meta font-semibold tabular-nums text-on-surf-v">Record refreshed {fmtTime(new Date(lastUpdated).toISOString())}</p>}
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
      {phases.map((phase, phaseIndex) => (
        <TimelinePhase
          key={phase.phase_event_id}
          trip={trip}
          phase={phase}
          precincts={precincts}
          isLast={phaseIndex === phases.length - 1}
          exceptions={sortExceptionsByEventTime(exceptionsById.filter(e => e.phase_event_id === phase.phase_event_id), evidence.artifactsById)}
          artifacts={artifacts}
          lookup={lookup}
          onChanged={evidence.onChanged}
          nowMs={now.getTime()}
          onOpenException={onOpenException}
          selectedExceptionId={selectedExceptionId}
          highlightedExceptionId={highlightedId}
          reveal={revealRequest?.phaseId === phase.phase_event_id ? { exceptionId: revealRequest.exceptionId, requestId: revealRequest.requestId } : null}
        />
      ))}
      {tripNotes.length > 0 && <section aria-label="Trip-level events" className="space-y-2 border-t border-outline-v/30 pt-4">
        <h3 className="text-body font-bold text-on-surf">Trip record</h3>
        {tripNotes.map(exception => <ExceptionRow
          key={exception.id}
          exception={exception}
          at={exceptionEventTime(exception, evidence.artifactsById)}
          phaseId={null}
          selected={exception.id === selectedExceptionId}
          highlighted={exception.id === highlightedId}
          onOpen={onOpenException}
        />)}
      </section>}
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
    <p className="min-w-0 text-body font-semibold text-on-surf">{originName} → En route to {destinationName}{exceptionCount ? ` · ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'}` : ''}</p>
    <Button variant="secondary" size="sm" onClick={onShow}>Show current leg</Button>
  </aside>
}
