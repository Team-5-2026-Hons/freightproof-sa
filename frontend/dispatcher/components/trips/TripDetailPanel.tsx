'use client'

import { useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { DetailPanel } from '@/components/ui/DetailPanel'
import type { Tab } from '@/components/ui/Tabs'
import { ManifestContent } from '@/components/domain/ManifestContent'
import { CancelTripDialog } from '@/components/domain/CancelTripAction'
import { IssueAuditPackDialog } from '@/components/domain/IssueAuditPackDialog'
import { DeclareIncidentDialog } from '@/components/domain/DeclareIncidentDialog'
import { AuditPacksPanel } from './AuditPacksPanel'
import { TripInformation } from './TripInformation'
import { PrecinctModal } from './PrecinctModal'
import { TripExceptionsPanel, type ExceptionFilter } from './TripExceptionsPanel'
import type { TripPanel } from './TripSummary'
import { uniqueExceptionsById } from './exception-dedupe'

const TITLES: Record<TripPanel, string> = { information: 'Trip information', manifest: 'Trip manifest', exceptions: 'Trip exceptions', audit: 'Audit packs' }

interface Props {
  panel: TripPanel; trip: Trip; precincts: Precinct[]; filter: ExceptionFilter
  selectedPhaseId?: string | null; invalidPhaseId?: string | null
  overlayOpen: boolean
  onSelect: (panel: TripPanel) => void
  onClose: () => void; onFilter: (value: ExceptionFilter) => void; onClearPhaseFilter?: () => void
  onShowInTimeline?: (phaseId: string) => void; onChanged: () => void; returnTo: string
}
export function TripDetailPanel({ panel, trip, precincts, filter, selectedPhaseId, invalidPhaseId, overlayOpen, onSelect, onClose, onFilter, onClearPhaseFilter, onShowInTimeline, onChanged, returnTo }: Props) {
  const exceptions = uniqueExceptionsById(trip.exceptions)
  const needsReview = exceptions.filter(e => e.review_status === 'needs_review').length
  // Rendered as siblings of DetailPanel, not inside it: below the dock width DetailPanel
  // wraps its own children in a <dialog>, and a modal nested inside another open modal
  // centers on that ancestor's box instead of the viewport.
  const [openPrecinct, setOpenPrecinct] = useState<Precinct | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [declareOpen, setDeclareOpen] = useState(false)
  // Bumped after an issue or a declaration so the audit tab remounts and refetches.
  const [packsVersion, setPacksVersion] = useState(0)
  const tabs: readonly Tab[] = [
    { id: 'information', label: 'Info' },
    { id: 'manifest', label: 'Manifest' },
    // The count is the reason a dispatcher opens this tab, so it rides on the tab itself
    // rather than waiting behind a click. Urgent only when something is actually owed.
    { id: 'exceptions', label: 'Exceptions', badge: exceptions.length, badgeUrgent: needsReview > 0 },
    { id: 'audit', label: 'Audit packs' },
  ]
  return <>
    <DetailPanel tabs={tabs} active={panel} onSelect={id => onSelect(id as TripPanel)} title={TITLES[panel]}
      onClose={onClose} overlayOpen={overlayOpen} ariaLabel="Trip detail">
      {panel === 'information' && <TripInformation trip={trip} precincts={precincts} onOpenPrecinct={setOpenPrecinct} onCancelTrip={() => setCancelOpen(true)} />}
      {panel === 'manifest' && <ManifestContent tripId={trip.id} />}
      {panel === 'audit' && <AuditPacksPanel key={packsVersion} tripId={trip.id} tripReference={trip.trip_reference} onIssue={() => setIssueOpen(true)} onDeclare={() => setDeclareOpen(true)} />}
      {panel === 'exceptions' && <TripExceptionsPanel trip={trip} precincts={precincts} filter={filter} selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} onFilter={onFilter} onClearPhaseFilter={onClearPhaseFilter} onShowInTimeline={onShowInTimeline} returnTo={returnTo} />}
    </DetailPanel>
    {openPrecinct && <PrecinctModal precinct={openPrecinct} open onClose={() => setOpenPrecinct(null)} returnTo={returnTo} />}
    <CancelTripDialog tripId={trip.id} status={trip.status} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
    <IssueAuditPackDialog tripId={trip.id} consignments={trip.consignments} open={issueOpen} onClose={() => setIssueOpen(false)} onIssued={() => setPacksVersion(v => v + 1)} />
    <DeclareIncidentDialog tripId={trip.id} open={declareOpen} onClose={() => setDeclareOpen(false)} onDeclared={() => setPacksVersion(v => v + 1)} />
  </>
}
