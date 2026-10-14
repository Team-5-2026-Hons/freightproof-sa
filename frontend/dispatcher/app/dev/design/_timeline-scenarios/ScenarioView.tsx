'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { artifactsByIdOf, type TimelineScenario } from '@/components/domain/__fixtures__/phase-acts'
import { PHASE_ANCHOR_PREFIX } from '@/components/trips/PhaseTimelineItem'
import { TripExceptionsPanel, type ExceptionFilter } from '@/components/trips/TripExceptionsPanel'
import { TripTimeline, TIMELINE_VIEWS, readingPhaseAnchor, timelineToolbarHeight, type TimelineView } from '@/components/trips/TripTimeline'
import type { RevealRequest } from '@/components/trips/useExceptionReveal'
import { useDismissExceptionSelection } from '@/components/trips/useDismissExceptionSelection'
import { uniqueExceptionsById } from '@/components/trips/exception-dedupe'
import { DetailPanel, useDocked } from '@/components/ui/DetailPanel'
import type { Tab } from '@/components/ui/Tabs'
import { currentTripPhase } from '@/lib/phase/trip-detail'
import { TRIP_LEVEL_SCOPE } from '@/lib/phase/exception-rows'
import { frameWidthPx, type ViewportPreset } from './frame'

interface Props {
  scenario: TimelineScenario
  /** 1-based position in the page's list, for the heading. */
  position: number
  preset: ViewportPreset
}

/** What the exceptions panel is open on. Mirrors the `phase` and `exception` query parameters
 *  the real trip page keeps in its URL; here they live in state, because this page has no trip route. */
interface PanelSelection {
  exceptionId: string | null
  phaseId: string | null
}

const PANEL_TAB_ID = 'exceptions'
const PREVIEW_RETURN_TO = '/dev/design'
const NO_OP = (): void => undefined
// Tall enough to read a record without the docked column growing with the timeline beside it.
const DOCKED_PANEL_CLASS = 'sticky top-4 flex h-[720px] max-h-[calc(100vh-2rem)]'

/**
 * One scenario: the REAL TripTimeline in a frame of the chosen width, and the real exceptions
 * panel beside it. The wiring between them is the trip page's own (open on a row, filter,
 * "Show in timeline" returning to the row), reduced to state. Whether the panel docks or is
 * an overlay is DetailPanel's own decision from the real window width, not the preset's.
 */
export function ScenarioView({ scenario, position, preset }: Props) {
  const { trip } = scenario
  const docked = useDocked()
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const pendingReadingAnchor = useRef<string | null>(null)
  const rememberReadingPhase = useCallback((): void => {
    const root = timelineRef.current
    // This preview uses the window reader; the real trip page uses its own scroller.
    pendingReadingAnchor.current = readingPhaseAnchor(root, Math.max(0, root?.getBoundingClientRect().top ?? 0) + timelineToolbarHeight(root))
  }, [])
  const [timelineView, setTimelineView] = useState<TimelineView>(TIMELINE_VIEWS.evidence)
  const changeTimelineView = useCallback((next: TimelineView): void => {
    if (next === timelineView) return
    rememberReadingPhase()
    setTimelineView(next)
  }, [timelineView, rememberReadingPhase])
  const [selection, setSelection] = useState<PanelSelection | null>(null)
  useDismissExceptionSelection(selection?.exceptionId ?? null, () => {
    setSelection(previous => previous ? { ...previous, exceptionId: null } : null)
  })
  const overlayOpen = !docked && selection !== null
  const [filter, setFilter] = useState<ExceptionFilter>('needs_review')
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const [pendingReveal, setPendingReveal] = useState<Omit<RevealRequest, 'requestId'> | null>(null)
  const artifactsById = useMemo(() => artifactsByIdOf(scenario), [scenario])
  const exceptions = uniqueExceptionsById(trip.exceptions)
  const needsReview = exceptions.filter(exception => exception.review_status === 'needs_review').length
  const tabs: readonly Tab[] = [{ id: PANEL_TAB_ID, label: 'Exceptions', badge: exceptions.length, badgeUrgent: needsReview > 0 }]
  // A link to one record or phase is an evidence view, not a review queue, so it shows everything.
  const effectiveFilter: ExceptionFilter = selection?.exceptionId || selection?.phaseId ? 'all' : filter
  const headingId = `scenario-heading-${scenario.id}`

  function openException(exceptionId: string | null, phaseId: string | null): void {
    setSelection({ exceptionId, phaseId: phaseId ?? TRIP_LEVEL_SCOPE })
    setFilter('all')
  }

  function showInTimeline(exceptionId: string, phaseId: string | null): void {
    pendingReadingAnchor.current = null
    setPendingReveal({ exceptionId, phaseId })
    // The overlay's focus trap has to be gone before focus can move into the timeline.
    if (!docked) setSelection(null)
  }

  useEffect(() => {
    if (!pendingReveal || overlayOpen) return
    const frame = window.requestAnimationFrame(() => {
      setReveal(previous => ({ ...pendingReveal, requestId: (previous?.requestId ?? 0) + 1 }))
      setPendingReveal(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingReveal, overlayOpen])

  function toggleExpanded(): void {
    rememberReadingPhase()
    setTimelineExpanded(previous => !previous)
  }

  useEffect(() => {
    if (!pendingReadingAnchor.current) return
    const frames: number[] = []
    frames.push(window.requestAnimationFrame(() => frames.push(window.requestAnimationFrame(() => {
      const anchor = pendingReadingAnchor.current
      pendingReadingAnchor.current = null
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
    }))))
    return () => frames.forEach(frame => window.cancelAnimationFrame(frame))
  }, [timelineView, timelineExpanded])

  function jump(): void {
    pendingReadingAnchor.current = null
    const active = currentTripPhase(trip)
    if (active) document.getElementById(`${PHASE_ANCHOR_PREFIX}${active.phase_event_id}`)?.scrollIntoView({ block: 'start' })
  }

  const panel = (
    <DetailPanel
      tabs={tabs}
      active={PANEL_TAB_ID}
      onSelect={NO_OP}
      title="Trip exceptions"
      onClose={() => setSelection(null)}
      overlayOpen={overlayOpen}
      ariaLabel="Trip detail"
    >
      <TripExceptionsPanel
        trip={trip}
        precincts={scenario.precincts}
        filter={effectiveFilter}
        artifactsById={artifactsById}
        selectedPhaseId={selection?.phaseId ?? null}
        selectedExceptionId={selection?.exceptionId ?? null}
        // Picking a filter leaves the single-record view, so the selection goes; the phase stays.
        onFilter={value => { setFilter(value); setSelection(previous => ({ exceptionId: null, phaseId: previous?.phaseId ?? null })) }}
        onClearPhaseFilter={() => setSelection({ exceptionId: null, phaseId: null })}
        onClearExceptionSelection={() => setSelection(previous => ({ exceptionId: null, phaseId: previous?.phaseId ?? null }))}
        onShowInTimeline={showInTimeline}
        returnTo={PREVIEW_RETURN_TO}
      />
    </DetailPanel>
  )

  return (
    <article id={`scenario-${scenario.id}`} aria-labelledby={headingId} className="mb-14 scroll-mt-20">
      <h3 id={headingId} className="text-title text-on-surf">{position}. {scenario.title}</h3>
      <p className="mt-1 max-w-3xl text-body text-on-surf">{scenario.demonstrates}</p>
      <p className="mt-1 text-meta tabular-nums text-on-surf-v">Scenario id {scenario.id} · {trip.trip_reference} · {trip.phases.length} phases</p>
      <div className="mt-4 overflow-x-auto">
        <div className="flex items-start">
          <div ref={timelineRef} className="shrink-0 rounded-xl border border-outline-v/30 bg-surf-lowest" style={{ width: timelineExpanded ? '100%' : frameWidthPx(preset) }}>
            <TripTimeline
              trip={trip}
              precincts={scenario.precincts}
              artifactsById={artifactsById}
              artifactLoading={false}
              artifactError={null}
              onRetryArtifacts={NO_OP}
              onChanged={NO_OP}
              lastUpdated={Date.parse(trip.updated_at)}
              onJump={jump}
              view={timelineView}
              onViewChange={changeTimelineView}
              expanded={timelineExpanded}
              onToggleExpanded={toggleExpanded}
              onOpenException={openException}
              selectedExceptionId={selection?.exceptionId ?? null}
              revealRequest={reveal}
              onRevealHandled={targetId => document.getElementById(targetId)?.scrollIntoView({ block: 'center' })}
            />
          </div>
          {/* Docked, DetailPanel is a permanent column and needs a height to scroll within; below the
              dock width it renders the overlay (or nothing), which takes no room in this row. */}
          {docked ? <div className={DOCKED_PANEL_CLASS}>{panel}</div> : panel}
        </div>
      </div>
    </article>
  )
}
