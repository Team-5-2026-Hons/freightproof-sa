'use client'

import type { Trip } from '@shared/lib/types/trip'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { Button } from '@/components/ui/Button'

export type ExceptionFilter = 'needs_review' | 'all'
interface Props {
  trip: Trip; filter: ExceptionFilter; onFilter: (filter: ExceptionFilter) => void; returnTo: string
  selectedPhaseId?: string | null
  invalidPhaseId?: string | null
  onClearPhaseFilter?: () => void
  onShowInTimeline?: (phaseId: string) => void
}
export function TripExceptionsPanel({ trip, filter, selectedPhaseId = null, invalidPhaseId = null, onFilter, onClearPhaseFilter, onShowInTimeline, returnTo }: Props) {
  if (invalidPhaseId) {
    return <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
      <p>This phase filter is not part of this trip.</p>
      <Button className="mt-3" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
    </div>
  }

  const scopedExceptions = selectedPhaseId
    ? trip.exceptions.filter(exception => exception.phase_event_id === selectedPhaseId)
    : trip.exceptions
  const exceptions = [...scopedExceptions].filter(e => filter === 'all' || e.review_status === 'needs_review')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const needsReview = scopedExceptions.filter(e => e.review_status === 'needs_review').length
  return <div>
    {selectedPhaseId && <div className="mb-4 rounded-lg border border-outline-v/30 bg-surf-low p-3 text-sm text-on-surf">
      <p>Selected phase · {scopedExceptions.length} of {trip.exceptions.length} trip exceptions</p>
      <Button className="mt-2" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
    </div>}
    {/* Each filter states its own size. Without it the unselected one is a blind click —
        a dispatcher looking at two rows had no way to tell whether "All recorded" held
        another ten or the same two, which is the question the button is there to answer. */}
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Exception filters">
      <Button variant={filter === 'needs_review' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('needs_review')}>Needs review · {needsReview}</Button>
      <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('all')}>All recorded · {scopedExceptions.length}</Button>
    </div>
    {!exceptions.length && <p className="py-5 text-sm text-on-surf-v">{filter === 'needs_review' ? 'No exceptions need review.' : 'No exceptions recorded.'}</p>}
    <div className="space-y-3">{exceptions.map(exception => {
      const phase = trip.phases.find(p => p.phase_event_id === exception.phase_event_id)
      return <div key={exception.id}>
        <ExceptionSummary exception={exception} phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'} returnTo={returnTo} />
        {phase && <Button className="mt-1" variant="ghost" size="sm" onClick={() => onShowInTimeline?.(phase.phase_event_id)}>Show in timeline</Button>}
      </div>
    })}</div>
  </div>
}
