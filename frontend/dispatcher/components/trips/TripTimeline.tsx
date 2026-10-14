'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import { fmtTime } from '@shared/lib/utils/datetime'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import type { OpenException } from '@/components/domain/ExceptionRow'
import { ExceptionRowList } from '@/components/domain/ExceptionRowList'
import { isTripLevelException, visibleExceptions } from '@/lib/phase/exception-rows'
import { useNow } from '@/lib/hooks/useNow'
import { sortedPlan } from '@/lib/phase/derive'
import { exceptionEventTime } from '@/lib/phase/acts'
import { currentTripPhase, precinctAtPhase, precinctLabel } from '@/lib/phase/trip-detail'
import { PHASE_ANCHOR_PREFIX, TIMELINE_TOOLBAR_HEIGHT_VAR } from './PhaseTimelineItem'
import { nextTripStop } from './PhaseEvidence'
import { TimelinePhase } from './TimelinePhase'
import { uniqueExceptionsById } from './exception-dedupe'
import { useExceptionReveal, type RevealRequest } from './useExceptionReveal'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'

export const TIMELINE_VIEWS = { evidence: 'evidence', minimised: 'minimised' } as const
export type TimelineView = (typeof TIMELINE_VIEWS)[keyof typeof TIMELINE_VIEWS]
export const TIMELINE_VIEW_CONTROL_ATTR = 'data-timeline-view-control'
export const TIMELINE_TOOLBAR_ATTR = 'data-timeline-toolbar'
const EXPAND_LABELS = { expand: 'Expand timeline', collapse: 'Return to trip layout' } as const
export const TRIP_RECORD_ANCHOR_ID = 'trip-record'
const VIEW_TABS = [{ id: TIMELINE_VIEWS.evidence, label: 'Evidence' }, { id: TIMELINE_VIEWS.minimised, label: 'Minimised' }] as const

export function timelineToolbarHeight(timeline: HTMLElement | null): number {
  return timeline?.querySelector<HTMLElement>(`[${TIMELINE_TOOLBAR_ATTR}]`)?.getBoundingClientRect().height ?? 0
}

/** Capture one phase for this transition only, using the unobscured top of the reader. */
export function readingPhaseAnchor(timeline: HTMLElement | null, readingTop?: number): string | null {
  if (!timeline) return null
  const top = readingTop ?? timeline.getBoundingClientRect().top + timelineToolbarHeight(timeline)
  const anchors = [...timeline.querySelectorAll<HTMLElement>(`[id^="${PHASE_ANCHOR_PREFIX}"], [id="${TRIP_RECORD_ANCHOR_ID}"]`)]
    .filter(anchor => anchor.getBoundingClientRect().height > 0)
  return (anchors.find(anchor => anchor.getBoundingClientRect().bottom > top) ?? anchors.at(-1))?.id ?? null
}

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
  view?: TimelineView
  onViewChange?: (view: TimelineView) => void
  expanded?: boolean
  onToggleExpanded?: () => void
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
  trip, precincts, lastUpdated, onJump, view = TIMELINE_VIEWS.evidence, onViewChange, expanded = false, onToggleExpanded, onOpenException = NO_OPEN, selectedExceptionId = null, revealRequest, onRevealHandled, ...evidence
}: Props): React.JSX.Element {
  const timelineRef = useRef<HTMLElement>(null)
  const viewControlId = useId()
  const bodyId = `${viewControlId}-body`
  const minimised = view === TIMELINE_VIEWS.minimised
  const keepSelection = { [KEEP_EXCEPTION_SELECTION_ATTR]: true }
  const toolbarRef = useCallback((element: HTMLDivElement | null): (() => void) | undefined => {
    if (!element) return
    const measure = (): void => {
      element.parentElement?.style.setProperty(TIMELINE_TOOLBAR_HEIGHT_VAR, `${element.getBoundingClientRect().height}px`)
    }
    // Wrapping and browser zoom change the reading space; never subtract a fixed header height.
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
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
    exceptionsById.filter(e => isTripLevelException(e, phaseIds)),
    evidence.artifactsById,
  )
  const tripVisible = visibleExceptions(tripNotes, revealRequest?.phaseId === null ? revealRequest.exceptionId : null)
  return <section ref={timelineRef} aria-label="Trip timeline" className={`mx-auto w-full px-4 pb-4 md:px-6 md:pb-6 ${expanded ? '' : 'max-w-4xl'}`}>
    {/* One slim row: the header above already names the trip, so the toolbar only carries controls. */}
    <div ref={toolbarRef} {...{ [TIMELINE_TOOLBAR_ATTR]: true }} className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-outline-v/30 bg-surf-lowest px-4 py-2 md:-mx-6 md:px-6">
      <h2 className="sr-only">Trip timeline</h2>
      <div {...{ [TIMELINE_VIEW_CONTROL_ATTR]: true }} {...keepSelection}>
        <Tabs tabs={VIEW_TABS} active={view} onChange={value => {
          if (value === TIMELINE_VIEWS.evidence || value === TIMELINE_VIEWS.minimised) onViewChange?.(value)
        }} size="sm" className="w-52 max-w-full" ariaLabel="Timeline view" panelId={bodyId} idPrefix={viewControlId} disabled={!onViewChange} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Reads the record's freshness, not a trip fact — an evidence view should always
            be able to say when what you are looking at was last read. */}
        {lastUpdated !== null && <p className="text-meta tabular-nums text-on-surf-v">Record refreshed {fmtTime(new Date(lastUpdated).toISOString())}</p>}
        {active && trip.status !== 'created' && <Button variant="secondary" size="sm" onClick={onJump} {...keepSelection}>Jump to current phase ↓</Button>}
        {onToggleExpanded && <Button variant="secondary" size="sm" onClick={onToggleExpanded} {...keepSelection}
          aria-label={expanded ? EXPAND_LABELS.collapse : EXPAND_LABELS.expand} title={expanded ? EXPAND_LABELS.collapse : EXPAND_LABELS.expand}>
          {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </Button>}
      </div>
    </div>
    {/* No space-y here: the rail has to run through the gap between rows, so each row
        owns its own bottom margin instead. */}
    <div id={bodyId} role="tabpanel" aria-labelledby={`${viewControlId}-${view}`}>
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
          minimised={minimised}
        />
      ))}
      <div id={TRIP_RECORD_ANCHOR_ID} style={{ scrollMarginTop: `var(${TIMELINE_TOOLBAR_HEIGHT_VAR}, 0px)` }}>
      {tripNotes.length > 0 && <section aria-label="Trip-level events" className="space-y-2 border-t border-outline-v/30 pt-4">
        <h3 className="text-body font-bold text-on-surf">Trip record</h3>
        <ExceptionRowList rows={tripNotes.filter(e => tripVisible.visibleIds.has(e.id)).map(exception => ({ exception, at: exceptionEventTime(exception, evidence.artifactsById) }))}
          hiddenCount={tripVisible.hiddenCount} phaseId={null} selectedId={selectedExceptionId} highlightedId={highlightedId} onOpen={onOpenException} />
      </section>}
      </div>
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
  return <aside aria-label="Current transit leg" style={{ top: `var(${TIMELINE_TOOLBAR_HEIGHT_VAR}, 0px)` }} className="sticky z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sec/30 bg-surf-lowest px-3 py-2 shadow-level-1">
    <p className="min-w-0 text-body font-semibold text-on-surf">{originName} → En route to {destinationName}{exceptionCount ? ` · ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'}` : ''}</p>
    <Button variant="secondary" size="sm" onClick={onShow} {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>Show current leg</Button>
  </aside>
}
