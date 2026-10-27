'use client'

import { Suspense, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { DriverTransferController, transferActionFor } from '@/components/trips/DriverTransferController'
import { DriverTransferDetail } from '@/components/trips/DriverTransferDetail'
import { TripSummary, TRIP_PANELS, type TripPanel } from '@/components/trips/TripSummary'
import { TripDetailSkeleton } from '@/components/trips/TripDetailSkeleton'
import { TripTimeline, TIMELINE_VIEWS, readingPhaseAnchor, timelineToolbarHeight, type TimelineView, type TimelineWarning } from '@/components/trips/TripTimeline'
import { useDocked } from '@/components/ui/DetailPanel'
import { TripDetailPanel, LEGACY_AUDIT_PANEL, type IncidentFocusRequest } from '@/components/trips/TripDetailPanel'
import { PHASE_ANCHOR_PREFIX } from '@/components/trips/PhaseTimelineItem'
import type { RevealRequest } from '@/components/trips/useExceptionReveal'
import { useDismissExceptionSelection } from '@/components/trips/useDismissExceptionSelection'
import { INCIDENT_ROW_ATTR } from '@/components/incidents/TripIncidentsSection'
import type { ExceptionFilter } from '@/components/trips/TripExceptionsPanel'
import { IntegritySummary } from '@/components/blockchain/IntegritySummary'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { useTripArtifacts } from '@/lib/hooks/useTripArtifacts'
import { useTripIncidents } from '@/lib/hooks/useIncidents'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { currentTripPhase, isTerminalTrip, tripHeaderFacts } from '@/lib/phase/trip-detail'
import { getTripSeed } from '@/lib/trips/tripSeed'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_TO_PARAM, safeReturnTo, withReturnTo } from '@/lib/navigation/returnTo'
import { buildTripPanelQuery } from '@/lib/trips/panel-query'
import { firstUnreviewedException, TRIP_LEVEL_SCOPE } from '@/lib/phase/exception-rows'
import { exceptionEventTime } from '@/lib/phase/acts'

const PANELS: readonly string[] = Object.values(TRIP_PANELS)
const INCIDENT_RECORD_ATTRS = ['data-incident-id', INCIDENT_ROW_ATTR] as const

/** Scrolls `item` to the top of `timelineRef`'s own scroll container: the exact
 *  positioning both the "Jump to current phase" button and the `#phase-<id>` hash-anchor
 *  effect below need, so the one rule for it lives in one place instead of two copies
 *  drifting apart. The hash target exists for a future exception-detail deep link; it
 *  needs `phase_event_id` added to `TripExceptionDetail` first (see the plan doc); no
 *  page links to it yet. A missing element (a stale hash, or a phase not yet rendered) is
 *  silently a no-op, never a thrown error. */
function scrollIntoTimeline(timelineRef: RefObject<HTMLDivElement | null>, item: HTMLElement | null): void {
  if (item && timelineRef.current) {
    timelineRef.current.scrollTop += item.getBoundingClientRect().top - timelineRef.current.getBoundingClientRect().top - timelineToolbarHeight(timelineRef.current)
  }
}

const LANDING_GAP_PX = 16

/** Where "Show in timeline" and the review chip put a row (L2). A row alone does not say which
 *  phase it belongs to, so land on its card's header when the header and the row both fit in
 *  view; otherwise put the row just below the toolbar with a gap, never flush against it. */
function landRowInTimeline(timelineRef: RefObject<HTMLDivElement | null>, row: HTMLElement | null): void {
  const scroller = timelineRef.current
  if (!row || !scroller) return
  const top = scroller.getBoundingClientRect().top + timelineToolbarHeight(scroller)
  const readerHeight = scroller.getBoundingClientRect().bottom - top
  const card = row.closest<HTMLElement>(`[id^="${PHASE_ANCHOR_PREFIX}"]`) ?? row.closest<HTMLElement>('section')
  const rowBox = row.getBoundingClientRect()
  const cardTop = card?.getBoundingClientRect().top
  const target = cardTop !== undefined && rowBox.bottom - cardTop + 2 * LANDING_GAP_PX <= readerHeight ? cardTop : rowBox.top
  scroller.scrollTop += target - top - LANDING_GAP_PX
}

export default function TripDetailPage() {
  return <Suspense fallback={<Spinner size="lg" />}><TripDetailRoute /></Suspense>
}

function TripDetailRoute() {
  const params = useParams()
  return <TripDetail key={String(params.id)} tripId={String(params.id)} />
}

function TripDetail({ tripId }: { tripId: string }) {
  const router = useRouter()
  const search = useSearchParams()
  const timelineRef = useRef<HTMLDivElement>(null)
  const docked = useDocked()
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const pendingReadingAnchor = useRef<string | null>(null)
  const [timelineView, setTimelineView] = useState<TimelineView>(TIMELINE_VIEWS.evidence)
  const changeTimelineView = useCallback((next: TimelineView): void => {
    if (next === timelineView) return
    pendingReadingAnchor.current = readingPhaseAnchor(timelineRef.current)
    setTimelineView(next)
  }, [timelineView])
  const { trip, isLoading, error, errorStatus, lastUpdated, refetchSilent } = useTripDetail(tripId)
  const artifacts = useTripArtifacts(tripId)
  const incidents = useTripIncidents(tripId)
  const { precincts, error: precinctsError, refetch: retryPrecincts } = usePrecincts()
  const panelValue = search.get('panel')
  const exceptionQuery = search.get('exception')
  const legacyAudit = panelValue === LEGACY_AUDIT_PANEL
  const selected = legacyAudit ? TRIP_PANELS.information : panelValue && PANELS.includes(panelValue) ? panelValue as TripPanel : exceptionQuery ? TRIP_PANELS.exceptions : null
  const panel: TripPanel = selected ?? TRIP_PANELS.information
  const overlayOpen = !docked && selected !== null
  const phaseQuery = search.get('phase')
  const selectedPhaseId = trip && phaseQuery && (phaseQuery === TRIP_LEVEL_SCOPE || trip.phases.some(phase => phase.phase_event_id === phaseQuery)) ? phaseQuery : null
  const invalidPhaseId = trip && phaseQuery && !selectedPhaseId ? phaseQuery : null
  const selectedExceptionId = trip && exceptionQuery && trip.exceptions.some(exception => exception.id === exceptionQuery) ? exceptionQuery : null
  const invalidExceptionId = trip && exceptionQuery && !selectedExceptionId ? exceptionQuery : null
  const filterParam = search.get('exceptions')
  const filter: ExceptionFilter = selectedPhaseId || selectedExceptionId || filterParam === 'all' ? 'all'
    : filterParam === 'reviewed' ? 'reviewed' : 'needs_review'
  useDismissExceptionSelection(selectedExceptionId, () => {
    const suffix = buildTripPanelQuery(search.toString(), { panel, filter, exceptionId: null })
    router.replace(`${ROUTES.tripDetail(tripId)}?${suffix}`, { scroll: false })
  })
  const [openTransferId, setOpenTransferId] = useState<string | null>(null)
  const [incidentFocus, setIncidentFocus] = useState<IncidentFocusRequest | null>(null)
  const selectedIncidentId = incidentFocus && panel === TRIP_PANELS.information && (docked || overlayOpen) ? incidentFocus.incidentId : null
  useDismissExceptionSelection(selectedIncidentId, () => setIncidentFocus(null), INCIDENT_RECORD_ATTRS)
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null)
  const [pendingTimelineReveal, setPendingTimelineReveal] = useState<Omit<RevealRequest, 'requestId'> | null>(null)
  const returnTo = `${ROUTES.tripDetail(tripId)}${search.size ? `?${search.toString()}` : ''}`
  useEffect(() => {
    if (artifacts.error) console.error('Evidence could not be refreshed.', artifacts.error)
  }, [artifacts.error])
  useEffect(() => {
    if (error) console.error('Trip updates unavailable.', error)
  }, [error])
  useEffect(() => {
    if (precinctsError) console.error('Location names could not be refreshed.', precinctsError)
  }, [precinctsError])
  const warnings: TimelineWarning[] = [
    ...(error ? [{ message: 'Trip updates unavailable · showing the last loaded record', onRetry: refetchSilent }] : []),
    ...(precinctsError ? [{ message: 'Location names could not be refreshed.', onRetry: retryPrecincts }] : []),
    ...(artifacts.error ? [{ message: 'Evidence could not be refreshed.', onRetry: artifacts.refetch }] : []),
  ]
  const seed = getTripSeed(tripId)
  const facts = tripHeaderFacts(trip, seed)

  function setPanel(next: TripPanel | null, nextFilter?: ExceptionFilter, nextPhaseId?: string | null, nextExceptionId?: string | null): void {
    const suffix = buildTripPanelQuery(search.toString(), { panel: next, filter: nextFilter, phaseId: nextPhaseId, exceptionId: nextExceptionId })
    router.push(`${ROUTES.tripDetail(tripId)}${suffix ? `?${suffix}` : ''}`, { scroll: false })
  }

  function toggleExpanded(): void {
    pendingReadingAnchor.current = readingPhaseAnchor(timelineRef.current)
    setTimelineExpanded(previous => !previous)
  }

  useEffect(() => {
    if (!pendingReadingAnchor.current) return
    const frames: number[] = []
    frames.push(window.requestAnimationFrame(() => frames.push(window.requestAnimationFrame(() => {
      const anchor = pendingReadingAnchor.current
      pendingReadingAnchor.current = null
      if (anchor) scrollIntoTimeline(timelineRef, document.getElementById(anchor))
    }))))
    return () => frames.forEach(frame => window.cancelAnimationFrame(frame))
  }, [timelineView, timelineExpanded])

  /** What an exception row on the timeline calls (D42). An exception id selects that
   *  record; a null id opens the panel on the phase's records ("+n more"). A null phase
   *  scopes the panel to the Trip record list. Opens the docked panel at
   *  1280 px and wider and the overlay below, by the URL alone. */
  function openException(exceptionId: string | null, phaseId: string | null): void {
    setPanel('exceptions', 'all', phaseId ?? TRIP_LEVEL_SCOPE, exceptionId)
  }

  const terminal = trip ? isTerminalTrip(trip) : seed?.status === 'closed' || seed?.status === 'cancelled'
  function back(): void { router.push(safeReturnTo(search.get(RETURN_TO_PARAM), terminal ? ROUTES.history : ROUTES.home)) }
  function jump(): void {
    if (!trip) return
    const active = currentTripPhase(trip)
    if (!active) return
    pendingReadingAnchor.current = null
    scrollIntoTimeline(timelineRef, document.getElementById(`${PHASE_ANCHOR_PREFIX}${active.phase_event_id}`))
  }

  function showIncident(incidentId: string): void {
    pendingReadingAnchor.current = null
    if (panel !== TRIP_PANELS.information || (!docked && !overlayOpen)) setPanel(TRIP_PANELS.information)
    setIncidentFocus(previous => ({ incidentId, requestId: (previous?.requestId ?? 0) + 1 }))
  }

  /** "Show in timeline" from the panel: the row for that exception, whichever phase (or the
   *  trip record) it belongs to. The counter makes a repeat request for the same row land again. */
  function showInTimeline(exceptionId: string, phaseId: string | null): void {
    pendingReadingAnchor.current = null
    setPendingTimelineReveal({ exceptionId, phaseId })
    if (!docked) setPanel(null)
  }

  /** The header's "N need review" chip: the same landing as "Show in timeline", aimed at the
   *  first unreviewed row in the order the timeline draws them. */
  function showFirstUnreviewed(): void {
    if (!trip) return
    const first = firstUnreviewedException(trip.phases, trip.exceptions, exception => exceptionEventTime(exception, artifacts.byId))
    if (!first) return
    const phaseId = trip.phases.some(phase => phase.phase_event_id === first.phase_event_id) ? first.phase_event_id : null
    showInTimeline(first.id, phaseId)
  }

  useEffect(() => {
    if (!pendingTimelineReveal || overlayOpen) return
    const frame = window.requestAnimationFrame(() => {
      setRevealRequest(previous => ({ ...pendingTimelineReveal, requestId: (previous?.requestId ?? 0) + 1 }))
      setPendingTimelineReveal(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingTimelineReveal, overlayOpen])

  useEffect(() => {
    if (!trip) return
    const hash = window.location.hash
    if (!hash.startsWith(`#${PHASE_ANCHOR_PREFIX}`)) return
    pendingReadingAnchor.current = null
    scrollIntoTimeline(timelineRef, document.getElementById(hash.slice(1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id])

  if (!trip) {
    if (isLoading) return <TripDetailSkeleton onBack={back}
      header={facts ? <TripSummary facts={facts} precincts={precincts} driver={null} returnTo={returnTo} onBack={back} onPanel={setPanel} /> : undefined} />
    return <div className="flex flex-1 flex-col gap-5 p-6">
      <div><BackButton onClick={back} /></div>
      <EmptyState icon={<Ic n="warn" s={32} />} title={errorStatus === 404 ? 'Trip not found' : 'Could not load trip'} body={error ?? 'No trip record is available.'} cta={<Button onClick={refetchSilent}>Retry</Button>} />
    </div>
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {facts && <DriverTransferController trip={trip} onChanged={refetchSilent}>{openTransfer =>
          <TripSummary facts={facts} precincts={precincts} driver={trip.driver ?? null} returnTo={returnTo} onBack={back} onPanel={setPanel} compact={timelineExpanded} onShowFirstUnreviewed={showFirstUnreviewed}
            transferAction={transferActionFor(trip, openTransfer)} />
        }</DriverTransferController>}
        <div ref={timelineRef} data-timeline-scroller className="min-h-0 flex-1 overflow-y-auto bg-surf-lowest">
          <TripTimeline trip={trip} precincts={precincts} artifactsById={artifacts.byId} artifactLoading={artifacts.isLoading} artifactError={artifacts.error} onRetryArtifacts={artifacts.refetch} onChanged={refetchSilent} lastUpdated={lastUpdated} onJump={jump}
            view={timelineView} onViewChange={changeTimelineView}
            expanded={timelineExpanded} onToggleExpanded={toggleExpanded}
            onOpenException={openException} onOpenTransfer={setOpenTransferId} incidents={incidents.data} onOpenIncident={showIncident} selectedIncidentId={selectedIncidentId} selectedExceptionId={selectedExceptionId} revealRequest={revealRequest} warnings={warnings}
            onRevealHandled={targetId => landRowInTimeline(timelineRef, document.getElementById(targetId))} />
          <IntegritySummary trip={trip} />
        </div>
      </div>
      <TripDetailPanel panel={panel} trip={trip} precincts={precincts} filter={filter} artifactsById={artifacts.byId}
        selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} selectedExceptionId={selectedExceptionId} invalidExceptionId={invalidExceptionId} overlayOpen={overlayOpen} scrollToAuditPacks={legacyAudit}
        onSelect={setPanel} onClose={() => setPanel(null)} onFilter={value => setPanel('exceptions', value, selectedPhaseId, null)}
        onClearPhaseFilter={() => setPanel('exceptions', undefined, null, null)} onClearExceptionSelection={() => setPanel('exceptions', undefined, undefined, null)} onShowInTimeline={showInTimeline}
        onChanged={refetchSilent} onOpenTransfer={setOpenTransferId} incidents={incidents} focusIncident={incidentFocus} returnTo={returnTo} onIncidentReported={id => router.push(withReturnTo(ROUTES.incidentDetail(id), returnTo))} />
    </div>
    {openTransferId && <Modal open onClose={() => setOpenTransferId(null)} title="Driver transfer evidence" size="lg">
      <DriverTransferDetail trip={trip} substitutionId={openTransferId} onChanged={refetchSilent} />
    </Modal>}
  </div>
}
