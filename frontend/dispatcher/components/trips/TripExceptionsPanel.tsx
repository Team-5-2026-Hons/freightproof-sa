'use client'

import type { Trip } from '@shared/lib/types/trip'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary } from '@/components/domain/ExceptionSummary'
import { Button } from '@/components/ui/Button'

export type ExceptionFilter = 'needs_review' | 'all'
interface Props { trip: Trip; filter: ExceptionFilter; onFilter: (filter: ExceptionFilter) => void; returnTo: string }
export function TripExceptionsPanel({ trip, filter, onFilter, returnTo }: Props) {
  const exceptions = [...trip.exceptions].filter(e => filter === 'all' || e.review_status === 'needs_review')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return <div>
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Exception filters">
      <Button variant={filter === 'needs_review' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('needs_review')}>Needs review</Button>
      <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => onFilter('all')}>All recorded</Button>
    </div>
    {!exceptions.length && <p className="py-5 text-sm text-on-surf-v">{filter === 'needs_review' ? 'No exceptions need review.' : 'No exceptions recorded.'}</p>}
    <div className="space-y-3">{exceptions.map(exception => {
      const phase = trip.phases.find(p => p.phase_event_id === exception.phase_event_id)
      return <ExceptionSummary key={exception.id} exception={exception} phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'} returnTo={returnTo} />
    })}</div>
  </div>
}
