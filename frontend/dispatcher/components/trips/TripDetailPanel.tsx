'use client'

import { useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { DetailPanel } from '@/components/ui/DetailPanel'
import type { Tab } from '@/components/ui/Tabs'
import { ManifestContent } from '@/components/domain/ManifestContent'
import { CancelTripDialog } from '@/components/domain/CancelTripAction'
import { TripInformation } from './TripInformation'
import { PrecinctModal } from './PrecinctModal'
import { TripExceptionsPanel, type ExceptionFilter } from './TripExceptionsPanel'
import type { TripPanel } from './TripSummary'

const TITLES: Record<TripPanel, string> = { information: 'Trip information', manifest: 'Trip manifest', exceptions: 'Trip exceptions' }

interface Props {
  panel: TripPanel; trip: Trip; precincts: Precinct[]; filter: ExceptionFilter
  selectedPhaseId?: string | null; invalidPhaseId?: string | null
  overlayOpen: boolean
  onSelect: (panel: TripPanel) => void
  onClose: () => void; onFilter: (value: ExceptionFilter) => void; onClearPhaseFilter?: () => void
  onShowInTimeline?: (phaseId: string) => void; onChanged: () => void; returnTo: string
}
export function TripDetailPanel({ panel, trip, precincts, filter, selectedPhaseId, invalidPhaseId, overlayOpen, onSelect, onClose, onFilter, onClearPhaseFilter, onShowInTimeline, onChanged, returnTo }: Props) {
  const needsReview = trip.exceptions.filter(e => e.review_status === 'needs_review').length
  // Rendered as siblings of DetailPanel, not inside it: below the dock width DetailPanel
  // wraps its own children in a <dialog>, and a modal nested inside another open modal
  // centers on that ancestor's box instead of the viewport.
  const [openPrecinct, setOpenPrecinct] = useState<Precinct | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const tabs: readonly Tab[] = [
    { id: 'information', label: 'Info' },
    { id: 'manifest', label: 'Manifest' },
    // The count is the reason a dispatcher opens this tab, so it rides on the tab itself
    // rather than waiting behind a click. Urgent only when something is actually owed.
    { id: 'exceptions', label: 'Exceptions', badge: trip.exceptions.length, badgeUrgent: needsReview > 0 },
  ]
  return <>
    <DetailPanel tabs={tabs} active={panel} onSelect={id => onSelect(id as TripPanel)} title={TITLES[panel]}
      onClose={onClose} overlayOpen={overlayOpen} ariaLabel="Trip detail">
      {panel === 'information' && <TripInformation trip={trip} precincts={precincts} onOpenPrecinct={setOpenPrecinct} onCancelTrip={() => setCancelOpen(true)} />}
      {panel === 'manifest' && <ManifestContent tripId={trip.id} />}
      {panel === 'exceptions' && <TripExceptionsPanel trip={trip} filter={filter} selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} onFilter={onFilter} onClearPhaseFilter={onClearPhaseFilter} onShowInTimeline={onShowInTimeline} returnTo={returnTo} />}
    </DetailPanel>
    {openPrecinct && <PrecinctModal precinct={openPrecinct} open onClose={() => setOpenPrecinct(null)} returnTo={returnTo} />}
    <CancelTripDialog tripId={trip.id} status={trip.status} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
  </>
}
