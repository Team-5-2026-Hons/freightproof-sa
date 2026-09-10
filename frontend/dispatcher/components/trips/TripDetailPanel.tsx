'use client'

import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { DetailPanel } from '@/components/ui/DetailPanel'
import type { Tab } from '@/components/ui/Tabs'
import { ManifestContent } from '@/components/domain/ManifestContent'
import { TripInformation } from './TripInformation'
import { TripExceptionsPanel, type ExceptionFilter } from './TripExceptionsPanel'
import type { TripPanel } from './TripSummary'

const TITLES: Record<TripPanel, string> = { information: 'Trip information', manifest: 'Trip manifest', exceptions: 'Trip exceptions' }

interface Props {
  panel: TripPanel; trip: Trip; precincts: Precinct[]; filter: ExceptionFilter
  overlayOpen: boolean
  onSelect: (panel: TripPanel) => void
  onClose: () => void; onFilter: (value: ExceptionFilter) => void; onChanged: () => void; returnTo: string
}
export function TripDetailPanel({ panel, trip, precincts, filter, overlayOpen, onSelect, onClose, onFilter, onChanged, returnTo }: Props) {
  const needsReview = trip.exceptions.filter(e => e.review_status === 'needs_review').length
  const tabs: readonly Tab[] = [
    { id: 'information', label: 'Info' },
    { id: 'manifest', label: 'Manifest' },
    // The count is the reason a dispatcher opens this tab, so it rides on the tab itself
    // rather than waiting behind a click. Urgent only when something is actually owed.
    { id: 'exceptions', label: 'Exceptions', badge: trip.exceptions.length, badgeUrgent: needsReview > 0 },
  ]
  return <DetailPanel tabs={tabs} active={panel} onSelect={id => onSelect(id as TripPanel)} title={TITLES[panel]}
    onClose={onClose} overlayOpen={overlayOpen} ariaLabel="Trip detail">
    {panel === 'information' && <TripInformation trip={trip} precincts={precincts} onChanged={onChanged} returnTo={returnTo} />}
    {panel === 'manifest' && <ManifestContent tripId={trip.id} />}
    {panel === 'exceptions' && <TripExceptionsPanel trip={trip} filter={filter} onFilter={onFilter} returnTo={returnTo} />}
  </DetailPanel>
}
