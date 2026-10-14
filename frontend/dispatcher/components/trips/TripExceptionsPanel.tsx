'use client'

import { useEffect, useRef, useState } from 'react'
import { EXCEPTION_BATCH_LIMIT, sortQueueChronologically } from '@/lib/exceptions/queue'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { precinctAtPhase } from '@/lib/phase/trip-detail'
import { ExceptionMapButton, hasExceptionMapEvidence } from './ExceptionMapButton'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary, exceptionSummaryTitleId } from '@/components/domain/ExceptionSummary'
import { ExceptionEvidence, exceptionHasEvidence } from '@/components/domain/ExceptionEvidence'
import { PositionDisagreement } from '@/components/domain/PositionDisagreement'
import { Button } from '@/components/ui/Button'
import { useDocked } from '@/components/ui/DetailPanel'
import { useAuth } from '@/lib/hooks/useAuth'
import { BatchReviewForm } from './BatchReviewForm'
import { uniqueExceptionsById } from './exception-dedupe'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'
import { exceptionRowId } from '@/components/domain/ExceptionRow'
import { PHASE_ANCHOR_PREFIX } from './PhaseTimelineItem'
import { isTripLevelException, TRIP_LEVEL_SCOPE } from '@/lib/phase/exception-rows'

export type ExceptionFilter = 'needs_review' | 'all'
interface Props {
  trip: Trip; precincts: Precinct[]; filter: ExceptionFilter; onFilter: (filter: ExceptionFilter) => void; returnTo: string
  /** The trip's artifacts by id, so an exception's supporting photo can be shown here
   *  (the timeline card that used to carry it is going away). */
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  selectedPhaseId?: string | null
  invalidPhaseId?: string | null
  /** The one record the panel was opened on (`exception=<id>` in the URL), already known
   *  to belong to this trip. */
  selectedExceptionId?: string | null
  /** An `exception` id in the URL that is not on this trip. */
  invalidExceptionId?: string | null
  onClearPhaseFilter?: () => void
  onClearExceptionSelection?: () => void
  /** The record's own id travels with its phase (null for a trip-level record), so the timeline can reveal that row. */
  onShowInTimeline?: (exceptionId: string, phaseId: string | null) => void
}
export function TripExceptionsPanel({ trip, precincts, filter, artifactsById, selectedPhaseId = null, invalidPhaseId = null, selectedExceptionId = null, invalidExceptionId = null, onFilter, onClearPhaseFilter, onClearExceptionSelection, onShowInTimeline, returnTo }: Props) {
  // Docked, this panel is DetailPanel's own `bg-surf-low` <aside>, a 'low' card there
  // is the exact same tone as its own container, indistinguishable but for a faint
  // border. Below the dock width it renders inside Modal instead, whose background is
  // already the 'lowest' tone (pure white, same value as bg-surf-lowest), a 'lowest'
  // card there would have the identical blending problem in the other direction. Each
  // context needs the tone its OWN container is not.
  const docked = useDocked()
  const tone = docked ? 'lowest' : 'low'
  const { user } = useAuth()
  const [batchSelection, setBatchSelection] = useState<{tripId: string; rows: TripException[]} | null>(null)
  const [grouping, setGrouping] = useState<'none' | 'phase'>('none')
  const batchOpen = batchSelection?.tripId === trip.id
  const selectedRef = useRef<HTMLDivElement>(null)
  // Scroll once per selection, not per render: a polling refetch hands this panel a new
  // trip object every few seconds, and re-running on that would drag a reader who has
  // scrolled on back to the record. The frame wait is for the overlay: Modal calls
  // showModal() in its own effect, which runs after this one (children first), and a
  // dialog that is not yet open has no layout to scroll within.
  //
  // Docked, the panel is a column after the whole timeline, so a keyboard reader who picked a
  // row would otherwise Tab through every card to reach the record (A1). Focus follows only when
  // a timeline row made the selection: a deep link or a reload leaves focus where the page put
  // it. The overlay has its own focus trap and needs none of this.
  useEffect(() => {
    if (!selectedExceptionId) return
    const fromTimelineRow = docked && document.activeElement?.id.startsWith(exceptionRowId('')) === true
    const frame = window.requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'center' })
      if (fromTimelineRow) selectedRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
    // `docked` is read for this selection only; resizing across the dock width is not a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExceptionId])
  if (invalidPhaseId || invalidExceptionId) {
    return <div className="space-y-3">
      {invalidPhaseId && <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
        <p>This phase filter is not part of this trip.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
      </div>}
      {invalidExceptionId && <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
        <p>This exception is not part of this trip.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onClearExceptionSelection}>Show all exceptions</Button>
      </div>}
    </div>
  }

  const tripExceptions = uniqueExceptionsById(trip.exceptions)
  const tripLevel = selectedPhaseId === TRIP_LEVEL_SCOPE
  const phaseIds = new Set(trip.phases.map(phase => phase.phase_event_id))
  const scopedExceptions = selectedPhaseId
    ? tripExceptions.filter(exception => tripLevel ? isTripLevelException(exception, phaseIds) : exception.phase_event_id === selectedPhaseId)
    : tripExceptions
  const exceptions = sortQueueChronologically(scopedExceptions.filter(e => filter === 'all' || e.review_status === 'needs_review'))
  const needsReview = scopedExceptions.filter(e => e.review_status === 'needs_review').length
  // Only what a dispatcher can sign for without deciding about a colleague's work or a
  // critical event: critical rows always get their own look, and a colleague's claim is
  // theirs to release or for this dispatcher to take over deliberately on the detail page.
  const batchable = scopedExceptions.filter(e =>
    e.review_status === 'needs_review'
    && e.severity !== 'critical'
    && (e.claimed_by_user_id === null || e.claimed_by_user_id === user?.id))
  // A record the URL selected but the phase filter excludes would otherwise open the panel
  // on nothing, with no sign of why; say so and offer the way out.
  const selectedOutsideScope = selectedExceptionId !== null && !scopedExceptions.some(e => e.id === selectedExceptionId)
  return <div>
    {selectedOutsideScope && <p role="status" className="mb-4 rounded-lg border border-warn/30 bg-warn-c/30 p-3 text-sm text-on-surf">The selected exception is outside this phase filter.</p>}
    {selectedPhaseId && <div className="mb-4 rounded-lg border border-outline-v/30 bg-surf-low p-3 text-sm text-on-surf">
      <p>{tripLevel ? 'Trip-level records' : 'Selected phase'} · {scopedExceptions.length} of {tripExceptions.length} trip exceptions</p>
      <Button className="mt-2" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
    </div>}
    {/* Each filter states its own size. Without it the unselected one is a blind click -
        a dispatcher looking at two rows had no way to tell whether "All recorded" held
        another ten or the same two, which is the question the button is there to answer. */}
    {/* Filters still leave the single-record view by their own action (page.tsx onFilter); the
        attribute only stops the click-off rule from navigating a second time. */}
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Exception filters" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>
      <Button variant={filter === 'needs_review' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('needs_review')}>Unreviewed · {needsReview}</Button>
      <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('all')}>All recorded · {scopedExceptions.length}</Button>
      {batchable.length > 0 && batchable.length <= EXCEPTION_BATCH_LIMIT && <Button variant="secondary" size="sm" onClick={() => setBatchSelection(batchOpen ? null : {tripId:trip.id, rows:batchable})} aria-expanded={batchOpen}>
        Review {batchable.length} {batchable.length === 1 ? 'warning' : 'warnings'}
      </Button>}
    </div>
    {batchable.length > EXCEPTION_BATCH_LIMIT && <p className="mb-4 text-sm text-on-surf-v">Narrow to a phase with at most {EXCEPTION_BATCH_LIMIT} eligible records before batch review.</p>}
    <label className="mb-4 flex flex-wrap items-center gap-3 text-xs text-on-surf-v" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>Group records<select value={grouping} onChange={e => setGrouping(e.target.value as 'none' | 'phase')} className="min-h-11 rounded-md border border-outline bg-surf-lowest px-3 text-sm text-on-surf"><option value="none">None, newest first</option><option value="phase">Recorded phase event</option></select></label>
    {batchOpen && batchSelection && <BatchReviewForm
      tripId={trip.id}
      tripReference={trip.trip_reference}
      exceptions={batchSelection.rows}
      key={trip.id}
      onDone={() => setBatchSelection(null)}
      onCancel={() => setBatchSelection(null)}
    />}
    {!exceptions.length && <p className="py-5 text-sm text-on-surf-v">{filter === 'needs_review' ? 'No exceptions need review.' : 'No exceptions recorded.'}</p>}
    <div className="space-y-3">{renderRecords()}</div>
  </div>

  function renderException(exception: TripException) {
      const phase = trip.phases.find(p => p.phase_event_id === exception.phase_event_id)
      const precinct = phase ? precinctAtPhase(trip, phase, precincts) : undefined
      const mapEvidence = hasExceptionMapEvidence(exception, phase, precinct)
      // A position finding compares the linked phase's own fixes, so it needs the phase;
      // a photo or fix on the record itself does not.
      const showsPositions = exception.exception_type === 'gps_mismatch' && phase !== undefined
      const hasSupportingEvidence = showsPositions || exceptionHasEvidence(exception)
      // Every record can be shown on the timeline, so the footer is never empty: the map and the
      // supporting evidence are what vary.
      const footer = <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* The map comes first: for a position finding it answers the dispatcher's
              first question ("how far off?") before any navigation does. */}
          {mapEvidence && <ExceptionMapButton exception={exception} phase={phase} precinct={precinct} />}
          {/* A trip-level record has no phase, but it has a row in the timeline's "Trip record" list. */}
          <Button variant="ghost" size="sm" onClick={() => onShowInTimeline?.(exception.id, phase?.phase_event_id ?? null)}>Show in timeline</Button>
        </div>
        {hasSupportingEvidence && <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-sec">Supporting evidence</summary>
          <div className="mt-3">
            {showsPositions && (
              // The panel's own map button above already draws a driver-raised finding from
              // its snapshot; the inner one is only needed when the record has none.
              <PositionDisagreement phase={phase} precinct={precinct} source={exception.source} hideMapButton={!exception.action_location_assessment} />
            )}
            <ExceptionEvidence exception={exception} artifactsById={artifactsById} />
          </div>
        </details>}
      </div>
      const selected = exception.id === selectedExceptionId
      // The selected record is a focus target (A1), named by its exception type. Its phase card's
      // anchor lets Escape return focus to that card when the row itself is not on the timeline.
      return <div key={exception.id} ref={selected ? selectedRef : undefined} data-exception-id={exception.id} aria-current={selected ? 'true' : undefined}
        data-phase-anchor={phase ? `${PHASE_ANCHOR_PREFIX}${phase.phase_event_id}` : undefined}
        {...(selected ? { tabIndex: -1, role: 'group', 'aria-labelledby': exceptionSummaryTitleId(exception.id) } : {})}
        className="rounded-lg [&_time]:text-on-surf-v focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec">
        <ExceptionSummary
          exception={exception}
          phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'}
          returnTo={returnTo}
          tone={tone}
          selected={selected}
          footer={footer}
        />
      </div>
  }
  function renderRecords() {
    if (grouping === 'none') return exceptions.map(renderException)
    const groups = new Map<string, TripException[]>()
    for (const exception of exceptions) {
      const key = exception.phase_event_id ?? 'trip-level'
      groups.set(key, [...(groups.get(key) ?? []), exception])
    }
    return [...groups.entries()].sort(([a, ar], [b, br]) => {
      const sorted = sortQueueChronologically([{id:a,created_at:ar[0].created_at},{id:b,created_at:br[0].created_at}])
      return sorted[0].id === a ? -1 : 1
    }).map(([key, rows]) => {
      const phase = trip.phases.find(p => p.phase_event_id === key)
      return <section key={key} data-phase-group={key} className="space-y-3">
        <h3 className="border-b border-outline-v/30 py-3 text-sm font-semibold break-words [overflow-wrap:anywhere]">{key === 'trip-level' ? 'Trip-level records' : phase ? `${PHASE_NAMES[phase.phase_type]} · ${phase.phase_event_id}` : `Recorded phase ${key}`}</h3>
        {rows.map(renderException)}
      </section>
    })
  }
}
