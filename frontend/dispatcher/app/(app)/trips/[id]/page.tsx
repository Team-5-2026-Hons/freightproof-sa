'use client'

import { Suspense, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { TripSummary, type TripPanel } from '@/components/trips/TripSummary'
import { TripDetailSkeleton } from '@/components/trips/TripDetailSkeleton'
import { TripTimeline } from '@/components/trips/TripTimeline'
import { TripDetailPanel } from '@/components/trips/TripDetailPanel'
import type { ExceptionFilter } from '@/components/trips/TripExceptionsPanel'
import { IntegritySummary } from '@/components/blockchain/IntegritySummary'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { useTripArtifacts } from '@/lib/hooks/useTripArtifacts'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { currentTripPhase, isTerminalTrip, tripHeaderFacts } from '@/lib/phase/trip-detail'
import { getTripSeed } from '@/lib/trips/tripSeed'
import { ROUTES } from '@/lib/constants/routes'

const PANELS: readonly string[] = ['information', 'manifest', 'exceptions']

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
  const selected = panelValue && PANELS.includes(panelValue) ? panelValue as TripPanel : null
  // Docked, the panel is permanent, so it always has a view: Information is the default.
  // The URL parameter still drives it, and below the dock width doubles as "the reader
  // asked for this", which is what raises the overlay.
  const panel: TripPanel = selected ?? 'information'
  const filter: ExceptionFilter = search.get('exceptions') === 'all' ? 'all' : 'needs_review'
  const returnTo = `${ROUTES.tripDetail(tripId)}${search.size ? `?${search.toString()}` : ''}`
  // What the list that led here already knew. Lets the header name the trip immediately
  // instead of holding the whole page behind one slow record fetch.
  const seed = getTripSeed(tripId)
  const facts = tripHeaderFacts(trip, seed)

  function setPanel(next: TripPanel | null, nextFilter?: ExceptionFilter): void {
    const query = new URLSearchParams(search.toString())
    if (next) query.set('panel', next)
    else query.delete('panel')
    if (nextFilter) query.set('exceptions', nextFilter)
    const suffix = query.toString()
    router.push(`${ROUTES.tripDetail(tripId)}${suffix ? `?${suffix}` : ''}`, { scroll: false })
  }

  const terminal = trip ? isTerminalTrip(trip) : seed?.status === 'closed' || seed?.status === 'cancelled'
  function back(): void { router.push(terminal ? ROUTES.history : ROUTES.home) }
  function jump(): void {
    if (!trip) return
    const active = currentTripPhase(trip)
    if (!active) return
    const item = document.getElementById(`phase-${active.phase_event_id}`)
    if (item && timelineRef.current) timelineRef.current.scrollTop += item.getBoundingClientRect().top - timelineRef.current.getBoundingClientRect().top
  }

  if (!trip) {
    if (isLoading) return <TripDetailSkeleton onBack={back}
      header={facts ? <TripSummary facts={facts} precincts={precincts} driver={null} returnTo={returnTo} onBack={back} onPanel={setPanel} /> : undefined} />
    return <div className="flex flex-1 flex-col gap-5 p-6">
      <div><Button variant="secondary" onClick={back}>Back</Button></div>
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
        <div ref={timelineRef} className="min-h-0 flex-1 overflow-y-auto bg-surf-lowest">
          <TripTimeline trip={trip} precincts={precincts} artifactsById={artifacts.byId} artifactLoading={artifacts.isLoading} artifactError={artifacts.error} onRetryArtifacts={artifacts.refetch} onChanged={refetchSilent} returnTo={returnTo} lastUpdated={lastUpdated} onJump={jump} />
          <IntegritySummary trip={trip} />
        </div>
      </div>
      <TripDetailPanel panel={panel} trip={trip} precincts={precincts} filter={filter} overlayOpen={selected !== null}
        onSelect={setPanel} onClose={() => setPanel(null)} onFilter={value => setPanel('exceptions', value)} onChanged={refetchSilent} returnTo={returnTo} />
    </div>
  </div>
}

function ResourceWarning({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warn/20 bg-warn-c/40 px-4 py-2 text-sm text-on-surf"><p>{message}</p><Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button></div>
}
