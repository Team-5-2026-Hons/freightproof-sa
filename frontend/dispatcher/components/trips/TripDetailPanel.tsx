'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { DetailPanel, useDocked } from '@/components/ui/DetailPanel'
import type { Tab } from '@/components/ui/Tabs'
import { ManifestContent } from '@/components/domain/ManifestContent'
import { CancelTripDialog } from '@/components/domain/CancelTripAction'
import { IssueAuditPackDialog } from '@/components/domain/IssueAuditPackDialog'
import { DeclareIncidentDialog } from '@/components/domain/DeclareIncidentDialog'
import { ReportIncidentDialog } from '@/components/incidents/ReportIncidentDialog'
import { TripIncidentsSection } from '@/components/incidents/TripIncidentsSection'
import { useTripIncidents } from '@/lib/hooks/useIncidents'
import { AuditPacksPanel } from './AuditPacksPanel'
import { DriverSubstitutionPanel } from './DriverSubstitutionPanel'
import { LateDriverEvidencePanel } from './LateDriverEvidencePanel'
import { TripInformation } from './TripInformation'
import { PrecinctModal } from './PrecinctModal'
import { DEFAULT_EXCEPTION_RECORD_SORT, EXCEPTION_RECORD_SORT_KEYS, firstExceptionRecordDir, TripExceptionsPanel, type ExceptionDensity, type ExceptionFilter, type ExceptionGrouping } from './TripExceptionsPanel'
import { useTableSort } from '@/lib/hooks/useTableSort'
import { TRIP_PANELS, type TripPanel } from './TripSummary'
import { uniqueExceptionsById } from './exception-dedupe'
import { TripHelp } from './TripHelp'
import type { TripHelpTopic } from './trip-help-copy'
import { LEGACY_AUDIT_PANEL } from '@/lib/trips/panel-query'

export { LEGACY_AUDIT_PANEL }
export const TRIP_AUDIT_PACKS_SECTION_ID = 'trip-audit-packs'
const AUDIT_HEADING_ID = `${TRIP_AUDIT_PACKS_SECTION_ID}-heading`
const PANEL_SCROLLER_SELECTOR = '[role="tabpanel"], dialog'
const TITLES: Record<TripPanel, string> = { information: 'Trip information', manifest: 'Cargo', exceptions: 'Trip exceptions' }
const HELP_TOPIC: Record<TripPanel, TripHelpTopic> = { information: 'info', manifest: 'cargo', exceptions: 'exceptions' }

/** Every driver who has held this trip, by id, for labelling their own late evidence. */
function participantNames(trip: Trip): Record<string, string> {
  const names: Record<string, string> = {}
  for (const driver of [trip.original_driver, trip.driver]) if (driver) names[driver.id] = driver.full_name
  for (const request of trip.driver_substitutions ?? []) {
    names[request.outgoing.id] = request.outgoing.full_name
    names[request.incoming.id] = request.incoming.full_name
  }
  return names
}

interface Props {
  panel: TripPanel; trip: Trip; precincts: Precinct[]; filter: ExceptionFilter
  /** Resolves an exception's supporting photo in the exceptions tab. */
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  selectedPhaseId?: string | null; invalidPhaseId?: string | null
  selectedExceptionId?: string | null; invalidExceptionId?: string | null
  overlayOpen: boolean
  /** Legacy audit links land here once; ordinary Info navigation starts at the top. */
  scrollToAuditPacks?: boolean
  onSelect: (panel: TripPanel) => void
  onClose: () => void; onFilter: (value: ExceptionFilter) => void; onClearPhaseFilter?: () => void; onClearExceptionSelection?: () => void
  onShowInTimeline?: (exceptionId: string, phaseId: string | null) => void; onChanged: () => void; returnTo: string
  /** Where to go once an incident is reported (the page owns routing; this panel does not). */
  onIncidentReported?: (incidentId: string) => void
}
export function TripDetailPanel({ panel, trip, precincts, filter, artifactsById, selectedPhaseId, invalidPhaseId, selectedExceptionId, invalidExceptionId, overlayOpen, scrollToAuditPacks = false, onSelect, onClose, onFilter, onClearPhaseFilter, onClearExceptionSelection, onShowInTimeline, onChanged, returnTo, onIncidentReported }: Props): React.JSX.Element {
  const docked = useDocked()
  const auditSectionRef = useRef<HTMLElement>(null)
  const auditLandingTripRef = useRef<string | null>(null)
  const auditTriggerRef = useRef<HTMLButtonElement | null>(null)
  const exceptions = uniqueExceptionsById(trip.exceptions)
  const needsReview = exceptions.filter(e => e.review_status === 'needs_review').length
  // Rendered as siblings of DetailPanel, not inside it: below the dock width DetailPanel
  // wraps its own children in a <dialog>, and a modal nested inside another open modal
  // centers on that ancestor's box instead of the viewport.
  const [openPrecinct, setOpenPrecinct] = useState<Precinct | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [declareOpen, setDeclareOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const tripIncidents = useTripIncidents(trip.id)
  // An exception belongs to one investigation; the report dialog offers only the free ones.
  const groupedExceptionIds = useMemo(
    () => new Set(tripIncidents.data.flatMap(i => i.exception_ids)), [tripIncidents.data],
  )
  // Re-key only the audit content: the trip information and its scroller stay put.
  const [packsVersion, setPacksVersion] = useState(0)
  // Held here, not in the exceptions panel, so these survive a visit to the Info or Cargo tab.
  const [exceptionGrouping, setExceptionGrouping] = useState<ExceptionGrouping>('none')
  // Reviewing is scan then open, so the pane starts as one line per record.
  const [exceptionDensity, setExceptionDensity] = useState<ExceptionDensity>('compact')
  const recordSort = useTableSort({ keys: EXCEPTION_RECORD_SORT_KEYS, firstDir: firstExceptionRecordDir, initial: DEFAULT_EXCEPTION_RECORD_SORT })
  const [auditMinimumHeight, setAuditMinimumHeight] = useState(0)
  useEffect(() => {
    if (!scrollToAuditPacks) { auditLandingTripRef.current = null; return }
    if (auditLandingTripRef.current === trip.id || panel !== TRIP_PANELS.information || (!docked && !overlayOpen)) return
    const section = auditSectionRef.current
    const scroller = section?.closest<HTMLElement>(PANEL_SCROLLER_SELECTOR)
    if (!section || !scroller) return
    // A short loading state must still have enough reading space to land at its heading.
    if (auditMinimumHeight < scroller.clientHeight) {
      setAuditMinimumHeight(scroller.clientHeight)
      return
    }
    // scrollIntoView would also move the timeline/page; move only this panel's scroller.
    scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    auditLandingTripRef.current = trip.id
  }, [scrollToAuditPacks, trip.id, panel, docked, overlayOpen, auditMinimumHeight])

  useEffect(() => {
    const trigger = auditTriggerRef.current
    if (issueOpen || declareOpen || !trigger) return
    // A successful action remounts AuditPacksPanel, so Modal may hold a detached trigger.
    const replacement = Array.from(auditSectionRef.current?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === trigger.textContent)
    const target = trigger.isConnected ? trigger : replacement
    target?.focus({ preventScroll: true })
    auditTriggerRef.current = null
  }, [issueOpen, declareOpen])

  function rememberAuditTrigger(): void {
    auditTriggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
  }

  function refreshAuditPacks(): void {
    // The keyed child's loading state empties its lists. Reserve their measured space
    // before the key changes, otherwise the browser clamps the mounted scroller's position.
    const height = auditSectionRef.current?.getBoundingClientRect().height ?? 0
    setAuditMinimumHeight(previous => Math.max(previous, height))
    setPacksVersion(previous => previous + 1)
  }
  const tabs: readonly Tab[] = [
    { id: TRIP_PANELS.information, label: 'Info' },
    { id: TRIP_PANELS.manifest, label: 'Cargo' },
    // The count is the reason a dispatcher opens this tab, so it rides on the tab itself
    // rather than waiting behind a click. Urgent only when something is actually owed.
    { id: TRIP_PANELS.exceptions, label: 'Exceptions', badge: exceptions.length, badgeUrgent: needsReview > 0 },
  ]
  return <>
    <DetailPanel tabs={tabs} active={panel} onSelect={id => onSelect(id as TripPanel)} title={TITLES[panel]}
      onClose={onClose} overlayOpen={overlayOpen} ariaLabel="Trip detail">
      {/* A zero-height row with the icon lifted into the panel's own top padding (20px, docked and in the overlay), so the help
          costs no space and the content starts exactly where it would without it. The 14px glyph sits 5px inside its 24px
          button, so the button overhangs the padding by that much to put the glyph on the content's right edge. */}
      <div className="relative h-0"><TripHelp topic={HELP_TOPIC[panel]} className="absolute -top-[22px] -right-[5px]" /></div>
      {panel === TRIP_PANELS.information && <div className="space-y-6">
        <TripInformation trip={trip} precincts={precincts} onOpenPrecinct={setOpenPrecinct} onCancelTrip={() => setCancelOpen(true)} />
        <DriverSubstitutionPanel trip={trip} onChanged={onChanged} />
        <LateDriverEvidencePanel tripId={trip.id} driverNames={participantNames(trip)} />
        <TripIncidentsSection incidents={tripIncidents.data} isLoading={tripIncidents.isLoading} returnTo={returnTo} onReport={() => setReportOpen(true)} />
        <section ref={auditSectionRef} id={TRIP_AUDIT_PACKS_SECTION_ID} aria-labelledby={AUDIT_HEADING_ID} style={{ minHeight: auditMinimumHeight || undefined }} className="border-t border-outline-v/30 pt-6">
          <AuditPacksPanel key={packsVersion} tripId={trip.id} tripReference={trip.trip_reference} headingId={AUDIT_HEADING_ID}
            onIssue={() => { rememberAuditTrigger(); setIssueOpen(true) }} onDeclare={() => { rememberAuditTrigger(); setDeclareOpen(true) }} />
        </section>
      </div>}
      {panel === TRIP_PANELS.manifest && <ManifestContent tripId={trip.id} />}
      {panel === TRIP_PANELS.exceptions && <TripExceptionsPanel trip={trip} precincts={precincts} filter={filter} grouping={exceptionGrouping} onGrouping={setExceptionGrouping} density={exceptionDensity} onDensity={setExceptionDensity} sort={recordSort.sort} onSort={recordSort.onSort} artifactsById={artifactsById} selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} selectedExceptionId={selectedExceptionId} invalidExceptionId={invalidExceptionId} onFilter={onFilter} onClearPhaseFilter={onClearPhaseFilter} onClearExceptionSelection={onClearExceptionSelection} onShowInTimeline={onShowInTimeline} returnTo={returnTo} />}
    </DetailPanel>
    {openPrecinct && <PrecinctModal precinct={openPrecinct} open onClose={() => setOpenPrecinct(null)} returnTo={returnTo} />}
    <CancelTripDialog tripId={trip.id} status={trip.status} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
    <IssueAuditPackDialog tripId={trip.id} consignments={trip.consignments} open={issueOpen} onClose={() => setIssueOpen(false)} onIssued={refreshAuditPacks} />
    <DeclareIncidentDialog tripId={trip.id} open={declareOpen} onClose={() => setDeclareOpen(false)} onDeclared={refreshAuditPacks} />
    <ReportIncidentDialog trip={trip} open={reportOpen} takenExceptionIds={groupedExceptionIds} onClose={() => setReportOpen(false)}
      onReported={incident => { setReportOpen(false); onChanged(); tripIncidents.refetchSilent(); onIncidentReported?.(incident.incident_id) }} />
  </>
}
