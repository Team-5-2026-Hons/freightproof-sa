'use client'

import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { precinctAtPhase } from '@/lib/phase/trip-detail'
import { ExceptionMapButton, hasExceptionMapEvidence } from './ExceptionMapButton'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { Button } from '@/components/ui/Button'
import { useDocked } from '@/components/ui/DetailPanel'
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
  // Docked, this panel is DetailPanel's own `bg-surf-low` <aside> — a 'low' card there
  // is the exact same tone as its own container, indistinguishable but for a faint
  // border. Below the dock width it renders inside Modal instead, whose background is
  // already the 'lowest' tone (pure white, same value as bg-surf-lowest) — a 'lowest'
  // card there would have the identical blending problem in the other direction. Each
  // context needs the tone its OWN container is not.
  const tone = useDocked() ? 'lowest' : 'low'
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
  const exceptions = [...scopedExceptions].filter(e => filter === 'all' || e.review_status === 'needs_review')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const needsReview = scopedExceptions.filter(e => e.review_status === 'needs_review').length
  return <div>
    {selectedPhaseId && <div className="mb-4 rounded-lg border border-outline-v/30 bg-surf-low p-3 text-sm text-on-surf">
      <p>Selected phase · {scopedExceptions.length} of {tripExceptions.length} trip exceptions</p>
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
      return <div key={exception.id}>
        <ExceptionSummary
          exception={exception}
          phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'}
          returnTo={returnTo}
          tone={tone}
          footer={footer || undefined}
        />
      </div>
    })}</div>
  </div>
}
