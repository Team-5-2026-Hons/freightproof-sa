'use client'

import { Suspense, useEffect, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { TripSummary, type TripPanel } from '@/components/trips/TripSummary'
import { TripDetailSkeleton } from '@/components/trips/TripDetailSkeleton'
import { TripTimeline } from '@/components/trips/TripTimeline'
import { TripDetailPanel } from '@/components/trips/TripDetailPanel'
import { PHASE_ANCHOR_PREFIX } from '@/components/trips/PhaseTimelineItem'
import type { RevealRequest } from '@/components/trips/useExceptionReveal'
import type { ExceptionFilter } from '@/components/trips/TripExceptionsPanel'
import { IntegritySummary } from '@/components/blockchain/IntegritySummary'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { useTripArtifacts } from '@/lib/hooks/useTripArtifacts'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { currentTripPhase, isTerminalTrip, tripHeaderFacts } from '@/lib/phase/trip-detail'
import { getTripSeed } from '@/lib/trips/tripSeed'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/navigation/returnTo'
import { buildTripPanelQuery } from '@/lib/trips/panel-query'

const PANELS: readonly string[] = ['information', 'manifest', 'exceptions', 'audit']
const DOCKED_PANEL_QUERY = '(min-width: 1280px)'

/** Scrolls `item` to the top of `timelineRef`'s own scroll container: the exact
 *  positioning both the "Jump to current phase" button and the `#phase-<id>` hash-anchor
 *  effect below need, so the one rule for it lives in one place instead of two copies
 *  drifting apart. The hash target exists for a future exception-detail deep link; it
 *  needs `phase_event_id` added to `TripExceptionDetail` first (see the plan doc); no
 *  page links to it yet. A missing element (a stale hash, or a phase not yet rendered) is
 *  silently a no-op, never a thrown error. */
function scrollIntoTimeline(timelineRef: RefObject<HTMLDivElement | null>, item: HTMLElement | null): void {
  if (item && timelineRef.current) {
    timelineRef.current.scrollTop += item.getBoundingClientRect().top - timelineRef.current.getBoundingClientRect().top
  }
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
  const { trip, isLoading, error, errorStatus, lastUpdated, refetchSilent } = useTripDetail(tripId)
  const artifacts = useTripArtifacts(tripId)
  const { precincts, error: precinctsError, refetch: retryPrecincts } = usePrecincts()
  const panelValue = search.get('panel')
  const exceptionQuery = search.get('exception')
  // A link to one exception names no tab of its own: `exception=<id>` alone must still
  // open the exceptions panel instead of landing on a page that shows nothing.
  const selected = panelValue && PANELS.includes(panelValue) ? panelValue as TripPanel : exceptionQuery ? 'exceptions' : null
  // Docked, the panel is permanent, so it always has a view: Information is the default.
  // The URL parameter still drives it, and below the dock width doubles as "the reader
  // asked for this", which is what raises the overlay.
  const panel: TripPanel = selected ?? 'information'
  const phaseQuery = search.get('phase')
  // A phase id belongs to this trip only when it appears in this plan. Keep an invalid
  // URL visible as a recoverable state below rather than silently showing unrelated
  // records — a copied link must never look successful when it is not.
  const selectedPhaseId = trip && phaseQuery && trip.phases.some(phase => phase.phase_event_id === phaseQuery) ? phaseQuery : null
  const invalidPhaseId = trip && phaseQuery && !selectedPhaseId ? phaseQuery : null
  // Same rule for the exception id: it must be one of this trip's records, or the panel
  // says so rather than showing something else.
  const selectedExceptionId = trip && exceptionQuery && trip.exceptions.some(exception => exception.id === exceptionQuery) ? exceptionQuery : null
  const invalidExceptionId = trip && exceptionQuery && !selectedExceptionId ? exceptionQuery : null
  // A phase link is an evidence view, not a review queue. It must retain every record
  // for that phase when browser history restores an older narrow-filter URL. A selected
  // exception is the same: it may be reviewed already, and "needs review" would hide it.
  const filter: ExceptionFilter = selectedPhaseId || selectedExceptionId || search.get('exceptions') === 'all' ? 'all' : 'needs_review'
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null)
  const [pendingOverlayReveal, setPendingOverlayReveal] = useState<Omit<RevealRequest, 'requestId'> | null>(null)
  const returnTo = `${ROUTES.tripDetail(tripId)}${search.size ? `?${search.toString()}` : ''}`
  // What the list that led here already knew. Lets the header name the trip immediately
  // instead of holding the whole page behind one slow record fetch.
  const seed = getTripSeed(tripId)
  const facts = tripHeaderFacts(trip, seed)

  // `undefined` keeps the phase / exception already in the URL; `null` clears it.
  function setPanel(next: TripPanel | null, nextFilter?: ExceptionFilter, nextPhaseId?: string | null, nextExceptionId?: string | null): void {
    const suffix = buildTripPanelQuery(search.toString(), { panel: next, filter: nextFilter, phaseId: nextPhaseId, exceptionId: nextExceptionId })
    router.push(`${ROUTES.tripDetail(tripId)}${suffix ? `?${suffix}` : ''}`, { scroll: false })
  }

  /** What an exception row on the timeline calls (D42). An exception id selects that
   *  record; a null id opens the panel on the phase's records ("+n more"). A null phase
   *  is a trip-level exception, so no phase filter is applied. Opens the docked panel at
   *  1280 px and wider and the overlay below, by the URL alone. */
  function openException(exceptionId: string | null, phaseId: string | null): void {
    setPanel('exceptions', 'all', phaseId, exceptionId)
  }

  const terminal = trip ? isTerminalTrip(trip) : seed?.status === 'closed' || seed?.status === 'cancelled'
  function back(): void { router.push(safeReturnTo(search.get(RETURN_TO_PARAM), terminal ? ROUTES.history : ROUTES.home)) }
  function jump(): void {
    if (!trip) return
    const active = currentTripPhase(trip)
    if (!active) return
    scrollIntoTimeline(timelineRef, document.getElementById(`${PHASE_ANCHOR_PREFIX}${active.phase_event_id}`))
  }

  /** "Show in timeline" from the panel: the row for that exception, whichever phase (or the
   *  trip record) it belongs to. The counter makes a repeat request for the same row land again. */
  function showInTimeline(exceptionId: string, phaseId: string | null): void {
    const request = { exceptionId, phaseId }
    if (window.matchMedia(DOCKED_PANEL_QUERY).matches) {
      setRevealRequest(previous => ({ ...request, requestId: (previous?.requestId ?? 0) + 1 }))
      return
    }
    // The overlay's focus trap must be gone before moving focus into the timeline. The
    // docked panel stays put: it is a sibling column, not an overlay to dismiss.
    setPendingOverlayReveal(request)
    setPanel(null)
  }

  useEffect(() => {
    if (!pendingOverlayReveal || selected !== null) return
    const frame = window.requestAnimationFrame(() => {
      setRevealRequest(previous => ({ ...pendingOverlayReveal, requestId: (previous?.requestId ?? 0) + 1 }))
      setPendingOverlayReveal(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingOverlayReveal, selected])

  // Handles a `#phase-<id>` hash on arrival, whatever put it there. Scroll that row into
  // view once the timeline has a trip to render rows for, but never auto-expand it
  // (PhaseTimelineItem's own open state is untouched), the same way `jump()` never opens
  // the card it scrolls to. No exception-detail page links to this hash yet (that needs
  // `phase_event_id` on `TripExceptionDetail` first, see the plan doc), so today this
  // only fires for a hand-typed or bookmarked URL; it costs nothing to keep wired up for
  // when that link exists. Keyed on
  // `trip?.id` alone, not `trip` itself: useTripDetail's background refetches replace the
  // whole trip object on every poll, and re-running this on each one would yank a reader
  // who has since scrolled elsewhere back down to the linked phase.
  useEffect(() => {
    if (!trip) return
    const hash = window.location.hash
    if (!hash.startsWith(`#${PHASE_ANCHOR_PREFIX}`)) return
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
    {/* The panel is a full-height sibling of the whole left column, not a neighbour of
        the timeline alone — so the header spans the reading column only and the panel
        runs top to bottom beside it. */}
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {facts && <TripSummary facts={facts} precincts={precincts} driver={trip.driver ?? null} returnTo={returnTo} onBack={back} onPanel={setPanel} />}
        {error && <ResourceWarning message={`Trip updates unavailable. Showing the last loaded record. ${error}`} onRetry={refetchSilent} />}
        {precinctsError && <ResourceWarning message={`Location names could not be refreshed. ${precinctsError}`} onRetry={retryPrecincts} />}
        {artifacts.error && <ResourceWarning message={`Evidence could not be refreshed. ${artifacts.error}`} onRetry={artifacts.refetch} />}
        <div ref={timelineRef} data-timeline-scroller className="min-h-0 flex-1 overflow-y-auto bg-surf-lowest">
          <TripTimeline trip={trip} precincts={precincts} artifactsById={artifacts.byId} artifactLoading={artifacts.isLoading} artifactError={artifacts.error} onRetryArtifacts={artifacts.refetch} onChanged={refetchSilent} lastUpdated={lastUpdated} onJump={jump}
            onOpenException={openException} selectedExceptionId={selectedExceptionId} revealRequest={revealRequest}
            onRevealHandled={targetId => scrollIntoTimeline(timelineRef, document.getElementById(targetId))} />
          <IntegritySummary trip={trip} />
        </div>
      </div>
      <TripDetailPanel panel={panel} trip={trip} precincts={precincts} filter={filter} artifactsById={artifacts.byId}
        selectedPhaseId={selectedPhaseId} invalidPhaseId={invalidPhaseId} selectedExceptionId={selectedExceptionId} invalidExceptionId={invalidExceptionId} overlayOpen={selected !== null}
        // Picking a filter is leaving the single-record view, so the selection goes.
        onSelect={setPanel} onClose={() => setPanel(null)} onFilter={value => setPanel('exceptions', value, selectedPhaseId, null)}
        onClearPhaseFilter={() => setPanel('exceptions', undefined, null)} onClearExceptionSelection={() => setPanel('exceptions', undefined, undefined, null)} onShowInTimeline={showInTimeline}
        onChanged={refetchSilent} returnTo={returnTo} />
    </div>
  </div>
}

function ResourceWarning({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warn/20 bg-warn-c/40 px-4 py-2 text-sm text-on-surf"><p>{message}</p><Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button></div>
}
