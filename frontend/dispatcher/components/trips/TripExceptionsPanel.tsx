'use client'

import { useState } from 'react'
import { fmtExceptionRaised } from '@/lib/format/exception'
import { EXCEPTION_BATCH_LIMIT, sortQueueChronologically } from '@/lib/exceptions/queue'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { precinctAtPhase } from '@/lib/phase/trip-detail'
import { ExceptionMapButton, hasExceptionMapEvidence } from './ExceptionMapButton'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { Button } from '@/components/ui/Button'
import { useDocked } from '@/components/ui/DetailPanel'
import { useAuth } from '@/lib/hooks/useAuth'
import { BatchReviewForm } from './BatchReviewForm'
import { uniqueExceptionsById } from './exception-dedupe'

export type ExceptionFilter = 'needs_review' | 'all'
interface Props {
  trip: Trip; precincts: Precinct[]; filter: ExceptionFilter; onFilter: (filter: ExceptionFilter) => void; returnTo: string
  selectedPhaseId?: string | null
  invalidPhaseId?: string | null
  onClearPhaseFilter?: () => void
  onShowInTimeline?: (phaseId: string) => void
}
export function TripExceptionsPanel({ trip, precincts, filter, selectedPhaseId = null, invalidPhaseId = null, onFilter, onClearPhaseFilter, onShowInTimeline, returnTo }: Props) {
  // Docked, this panel is DetailPanel's own `bg-surf-low` <aside>, a 'low' card there
  // is the exact same tone as its own container, indistinguishable but for a faint
  // border. Below the dock width it renders inside Modal instead, whose background is
  // already the 'lowest' tone (pure white, same value as bg-surf-lowest), a 'lowest'
  // card there would have the identical blending problem in the other direction. Each
  // context needs the tone its OWN container is not.
  const tone = useDocked() ? 'lowest' : 'low'
  const { user } = useAuth()
  const [batchSelection, setBatchSelection] = useState<{tripId: string; rows: TripException[]} | null>(null)
  const [grouping, setGrouping] = useState<'none' | 'phase'>('none')
  const batchOpen = batchSelection?.tripId === trip.id
  if (invalidPhaseId) {
    return <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
      <p>This phase filter is not part of this trip.</p>
      <Button className="mt-3" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
    </div>
  }

  const tripExceptions = uniqueExceptionsById(trip.exceptions)
  const scopedExceptions = selectedPhaseId
    ? tripExceptions.filter(exception => exception.phase_event_id === selectedPhaseId)
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
  return <div>
    {selectedPhaseId && <div className="mb-4 rounded-lg border border-outline-v/30 bg-surf-low p-3 text-sm text-on-surf">
      <p>Selected phase · {scopedExceptions.length} of {tripExceptions.length} trip exceptions</p>
      <Button className="mt-2" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
    </div>}
    {/* Each filter states its own size. Without it the unselected one is a blind click -
        a dispatcher looking at two rows had no way to tell whether "All recorded" held
        another ten or the same two, which is the question the button is there to answer. */}
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Exception filters">
      <Button variant={filter === 'needs_review' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('needs_review')}>Unreviewed · {needsReview}</Button>
      <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('all')}>All recorded · {scopedExceptions.length}</Button>
      {batchable.length > 0 && batchable.length <= EXCEPTION_BATCH_LIMIT && <Button variant="secondary" size="sm" onClick={() => setBatchSelection(batchOpen ? null : {tripId:trip.id, rows:batchable})} aria-expanded={batchOpen}>
        Review {batchable.length} {batchable.length === 1 ? 'warning' : 'warnings'}
      </Button>}
    </div>
    {batchable.length > EXCEPTION_BATCH_LIMIT && <p className="mb-4 text-sm text-on-surf-v">Narrow to a phase with at most {EXCEPTION_BATCH_LIMIT} eligible records before batch review.</p>}
    <label className="mb-4 flex flex-wrap items-center gap-3 text-xs text-on-surf-v">Group records<select value={grouping} onChange={e => setGrouping(e.target.value as 'none' | 'phase')} className="min-h-11 rounded-md border border-outline bg-surf-lowest px-3 text-sm text-on-surf"><option value="none">None, newest first</option><option value="phase">Recorded phase event</option></select></label>
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
      // Same footer mechanism the timeline card uses: nothing renders (no stray
      // divider) when this record has neither a map nor a phase to jump to.
      const footer = (mapEvidence || phase) && <div className="flex flex-wrap items-center gap-2">
        {/* The map comes first: for a position finding it answers the dispatcher's
            first question ("how far off?") before any navigation does. */}
        {mapEvidence && <ExceptionMapButton exception={exception} phase={phase} precinct={precinct} />}
        {phase && <Button variant="ghost" size="sm" onClick={() => onShowInTimeline?.(phase.phase_event_id)}>Show in timeline</Button>}
      </div>
      return <div key={exception.id} className="[&_time]:text-on-surf-v">
        <p className="mb-2 break-words text-xs text-on-surf-v tabular-nums">Trip {trip.trip_reference} · Raised {fmtExceptionRaised(exception.created_at)}</p>
        <ExceptionSummary
          exception={exception}
          phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'}
          returnTo={returnTo}
          tone={tone}
          footer={footer || undefined}
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
