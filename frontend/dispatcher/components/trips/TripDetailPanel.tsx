'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { DetailPanel, useDocked } from '@/components/ui/DetailPanel'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Disclosure, disclosureHeadingId } from '@/components/ui/Disclosure'
import type { Tab } from '@/components/ui/Tabs'
import { ManifestContent } from '@/components/domain/ManifestContent'
import { CancelTripDialog, isTripTerminal } from '@/components/domain/CancelTripAction'
import { IssueAuditPackDialog } from '@/components/domain/IssueAuditPackDialog'
import { DeclareIncidentDialog } from '@/components/domain/DeclareIncidentDialog'
import { ReportIncidentDialog } from '@/components/incidents/ReportIncidentDialog'
import { INCIDENT_ROW_ATTR, TripIncidentsSection } from '@/components/incidents/TripIncidentsSection'
import { TripPoliceDetails } from '@/components/incidents/TripPoliceDetails'
import type { AsyncState } from '@/lib/hooks/useAsyncData'
import type { IncidentSummary, IncidentType } from '@/lib/types/incident'
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
import { INCIDENT_STATUS_CHIP } from '@/components/incidents/IncidentStatusChip'
import { AUDIT_SUMMARY, custodySummary, hasActiveIncident, hasPendingTransfer, incidentsSummary, leadingActiveIncidentStatus } from '@/lib/trips/info-summary'

export { LEGACY_AUDIT_PANEL }
export const TRIP_AUDIT_PACKS_SECTION_ID = 'trip-audit-packs'
const AUDIT_SECTION = 'audit'
const TRIP_ACTIONS_HEADING_ID = 'trip-actions-heading'
const NO_OPEN_TRANSFER = (): void => undefined
const INCIDENT_HIGHLIGHT_MS = 2000
const INCIDENT_LANDING_MAX_FRAMES = 20
const INCIDENT_LANDING_GAP_PX = 12

/** A page-originated "show this incident": the counter lets the same incident be asked for again. */
export interface IncidentFocusRequest { incidentId: string; requestId: number }
const HIJACKING_INCIDENT: IncidentType = 'hijacking'
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
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  selectedPhaseId?: string | null; invalidPhaseId?: string | null
  selectedExceptionId?: string | null; invalidExceptionId?: string | null
  overlayOpen: boolean
  scrollToAuditPacks?: boolean
  onSelect: (panel: TripPanel) => void
  onClose: () => void; onFilter: (value: ExceptionFilter) => void; onClearPhaseFilter?: () => void; onClearExceptionSelection?: () => void
  onShowInTimeline?: (exceptionId: string, phaseId: string | null) => void; onChanged: () => void; returnTo: string
  incidents: AsyncState<IncidentSummary[]>
  /** Where to go once an incident is reported (the page owns routing; this panel does not). */
  onIncidentReported?: (incidentId: string) => void
  /** Opens a completed driver transfer's evidence. The page owns that modal, shared with the timeline. */
  onOpenTransfer?: (substitutionId: string) => void
  focusIncident?: IncidentFocusRequest | null
}
export function TripDetailPanel({ panel, trip, precincts, filter, artifactsById, selectedPhaseId, invalidPhaseId, selectedExceptionId, invalidExceptionId, overlayOpen, scrollToAuditPacks = false, onSelect, onClose, onFilter, onClearPhaseFilter, onClearExceptionSelection, onShowInTimeline, onChanged, returnTo, incidents: tripIncidents, onIncidentReported, onOpenTransfer = NO_OPEN_TRANSFER, focusIncident = null }: Props): React.JSX.Element {
  const docked = useDocked()
  const sectionsRef = useRef<HTMLDivElement>(null)
  const auditSectionRef = useRef<HTMLElement>(null)
  const auditLandingTripRef = useRef<string | null>(null)
  const auditTriggerRef = useRef<HTMLButtonElement | null>(null)
  const exceptions = uniqueExceptionsById(trip.exceptions)
  const needsReview = exceptions.filter(e => e.review_status === 'needs_review').length
  const hasCriticalException = exceptions.some(e => e.severity === 'critical')
  const pendingTransfer = hasPendingTransfer(trip)
  const [openPrecinct, setOpenPrecinct] = useState<Precinct | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [declareOpen, setDeclareOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const activeIncident = hasActiveIncident(tripIncidents.data)
  const leadingStatus = leadingActiveIncidentStatus(tripIncidents.data)
  const incidentsText = incidentsSummary(tripIncidents.data, tripIncidents.isLoading, tripIncidents.error !== null)
  const canBuildSheet = hasCriticalException || tripIncidents.data.some(i => i.incident_type === HIJACKING_INCIDENT)
  const groupedExceptionIds = useMemo(
    () => new Set(tripIncidents.data.flatMap(i => i.exception_ids)), [tripIncidents.data],
  )
  const [packsVersion, setPacksVersion] = useState(0)
  const [policeVersion, setPoliceVersion] = useState(0)
  const [exceptionGrouping, setExceptionGrouping] = useState<ExceptionGrouping>('none')
  const [exceptionDensity, setExceptionDensity] = useState<ExceptionDensity>('compact')
  const recordSort = useTableSort({ keys: EXCEPTION_RECORD_SORT_KEYS, firstDir: firstExceptionRecordDir, initial: DEFAULT_EXCEPTION_RECORD_SORT })
  const [auditMinimumHeight, setAuditMinimumHeight] = useState(0)
  const landingFrameRef = useRef<number | null>(null)
  useEffect(() => () => { if (landingFrameRef.current !== null) window.cancelAnimationFrame(landingFrameRef.current) }, [])
  useEffect(() => {
    if (!scrollToAuditPacks) { auditLandingTripRef.current = null; return }
    if (auditLandingTripRef.current === trip.id || panel !== TRIP_PANELS.information || (!docked && !overlayOpen)) return
    const section = auditSectionRef.current
    const scroller = section?.closest<HTMLElement>(PANEL_SCROLLER_SELECTOR)
    if (!section || !scroller) return
    if (auditMinimumHeight < scroller.clientHeight) {
      setAuditMinimumHeight(scroller.clientHeight)
      return
    }
    scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    auditLandingTripRef.current = trip.id
    landingFrameRef.current = window.requestAnimationFrame(() => setAuditMinimumHeight(0))
  }, [scrollToAuditPacks, trip.id, panel, docked, overlayOpen, auditMinimumHeight])

  const [highlightedIncidentId, setHighlightedIncidentId] = useState<string | null>(null)
  const handledFocusRef = useRef<number | null>(null)
  const infoVisible = panel === TRIP_PANELS.information && (docked || overlayOpen)
  useEffect(() => {
    if (!focusIncident || !infoVisible || handledFocusRef.current === focusIncident.requestId) return
    let frame = 0
    let handle: number | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const land = (): void => {
      const row = sectionsRef.current?.querySelector<HTMLElement>(`[${INCIDENT_ROW_ATTR}="${focusIncident.incidentId}"]`)
      if (!row) {
        if (++frame < INCIDENT_LANDING_MAX_FRAMES) handle = window.requestAnimationFrame(land)
        return
      }
      handledFocusRef.current = focusIncident.requestId
      const scroller = row.closest<HTMLElement>(PANEL_SCROLLER_SELECTOR)
      if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - INCIDENT_LANDING_GAP_PX
      row.focus({ preventScroll: true })
      setHighlightedIncidentId(focusIncident.incidentId)
      timeout = setTimeout(() => setHighlightedIncidentId(null), INCIDENT_HIGHLIGHT_MS)
    }
    handle = window.requestAnimationFrame(land)
    return () => {
      if (handle !== null) window.cancelAnimationFrame(handle)
      if (timeout !== null) clearTimeout(timeout)
    }
  }, [focusIncident, infoVisible, tripIncidents.data])

  useEffect(() => {
    const trigger = auditTriggerRef.current
    if (issueOpen || declareOpen || !trigger) return
    const replacement = Array.from(sectionsRef.current?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === trigger.textContent)
    const target = trigger.isConnected ? trigger : replacement
    target?.focus({ preventScroll: true })
    auditTriggerRef.current = null
  }, [issueOpen, declareOpen])

  function rememberTrigger(): void {
    auditTriggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
  }

  function refreshAuditPacks(): void {
    const height = auditSectionRef.current?.getBoundingClientRect().height ?? 0
    setAuditMinimumHeight(previous => Math.max(previous, height))
    setPacksVersion(previous => previous + 1)
  }
  const tabs: readonly Tab[] = [
    { id: TRIP_PANELS.information, label: 'Info' },
    { id: TRIP_PANELS.manifest, label: 'Cargo' },
    { id: TRIP_PANELS.exceptions, label: 'Exceptions', badge: exceptions.length, badgeUrgent: needsReview > 0 },
  ]
  return <>
    <DetailPanel tabs={tabs} active={panel} onSelect={id => onSelect(id as TripPanel)} title={TITLES[panel]}
      onClose={onClose} overlayOpen={overlayOpen} ariaLabel="Trip detail">
      <div className="relative h-0"><TripHelp topic={HELP_TOPIC[panel]} className="absolute -top-[22px] -right-[5px]" /></div>
      {panel === TRIP_PANELS.information && <div ref={sectionsRef} className="divide-y divide-outline-v">
        <TripInformation trip={trip} precincts={precincts} onOpenPrecinct={setOpenPrecinct} />
        <Disclosure id="custody" title="Driver & custody" defaultOpen={pendingTransfer}
          summary={pendingTransfer ? <Chip type="pending" label={custodySummary(trip)} /> : custodySummary(trip)}>
          <DriverSubstitutionPanel trip={trip} onOpenTransfer={onOpenTransfer} />
          <LateDriverEvidencePanel tripId={trip.id} driverNames={participantNames(trip)} />
        </Disclosure>
        <Disclosure id="incidents" title="Incidents" defaultOpen={activeIncident} forceOpenKey={focusIncident?.requestId ?? null}
          summary={leadingStatus ? <Chip type={INCIDENT_STATUS_CHIP[leadingStatus]} label={incidentsText} /> : incidentsText}>
          <TripIncidentsSection incidents={tripIncidents.data} isLoading={tripIncidents.isLoading} error={tripIncidents.error} onRetry={tripIncidents.refetch} returnTo={returnTo} onReport={() => setReportOpen(true)} highlightedId={highlightedIncidentId} />
          <TripPoliceDetails tripId={trip.id} tripReference={trip.trip_reference} showSection={tripIncidents.data.length > 0 || hasCriticalException} canBuildSheet={canBuildSheet} refreshKey={policeVersion}
            onDeclare={() => { rememberTrigger(); setDeclareOpen(true) }} />
        </Disclosure>
        <section ref={auditSectionRef} id={TRIP_AUDIT_PACKS_SECTION_ID} aria-labelledby={disclosureHeadingId(AUDIT_SECTION)} style={{ minHeight: auditMinimumHeight || undefined }}>
          <Disclosure id={AUDIT_SECTION} title="Audit packs" summary={AUDIT_SUMMARY} forceOpenKey={scrollToAuditPacks ? trip.id : null}
            onOpenChange={open => { if (!open) setAuditMinimumHeight(0) }}>
            <AuditPacksPanel key={packsVersion} tripId={trip.id} tripReference={trip.trip_reference} onLoaded={() => setAuditMinimumHeight(0)}
              onIssue={() => { rememberTrigger(); setIssueOpen(true) }} />
          </Disclosure>
        </section>
        {!isTripTerminal(trip.status) && <section aria-labelledby={TRIP_ACTIONS_HEADING_ID} className="py-4">
          <h3 id={TRIP_ACTIONS_HEADING_ID} className="mb-2 text-sm font-bold text-on-surf">Trip actions</h3>
          <Button variant="danger" size="sm" full onClick={() => setCancelOpen(true)}>Cancel trip</Button>
        </section>}
      </div>}
      {panel === TRIP_PANELS.manifest && <ManifestContent tripId={trip.id} />}
      {panel === TRIP_PANELS.exceptions && <TripExceptionsPanel trip={trip} precincts={precincts} filter={filter} grouping={exceptionGrouping} onGrouping={setExceptionGrouping} density={exceptionDensity} onDensity={setExceptionDensity} sort={recordSort.sort} onSort={recordSort.onSort} artifactsById={artifactsById} selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} selectedExceptionId={selectedExceptionId} invalidExceptionId={invalidExceptionId} onFilter={onFilter} onClearPhaseFilter={onClearPhaseFilter} onClearExceptionSelection={onClearExceptionSelection} onShowInTimeline={onShowInTimeline} returnTo={returnTo} />}
    </DetailPanel>
    {openPrecinct && <PrecinctModal precinct={openPrecinct} open onClose={() => setOpenPrecinct(null)} returnTo={returnTo} />}
    <CancelTripDialog tripId={trip.id} status={trip.status} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
    <IssueAuditPackDialog tripId={trip.id} consignments={trip.consignments} open={issueOpen} onClose={() => setIssueOpen(false)} onIssued={refreshAuditPacks} />
    <DeclareIncidentDialog tripId={trip.id} open={declareOpen} onClose={() => setDeclareOpen(false)} onDeclared={() => setPoliceVersion(previous => previous + 1)} />
    <ReportIncidentDialog trip={trip} open={reportOpen} takenExceptionIds={groupedExceptionIds} onClose={() => setReportOpen(false)}
      onReported={incident => { setReportOpen(false); onChanged(); tripIncidents.refetchSilent(); onIncidentReported?.(incident.incident_id) }} />
  </>
}
