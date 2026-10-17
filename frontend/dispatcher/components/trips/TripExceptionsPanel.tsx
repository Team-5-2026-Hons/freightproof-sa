'use client'

import { useEffect, useRef, useState } from 'react'
import { EXCEPTION_BATCH_LIMIT } from '@/lib/exceptions/queue'
import { compareText, sortRows, type Sort } from '@/lib/sort/sort-rows'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { phaseStopLabel, precinctAtPhase } from '@/lib/phase/trip-detail'
import { ExceptionMapButton, hasExceptionMapEvidence } from './ExceptionMapButton'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { ExceptionSummary, exceptionSummaryTitleId } from '@/components/domain/ExceptionSummary'
import { ExceptionRef } from '@/components/domain/ExceptionRef'
import { ExceptionEvidence, exceptionHasEvidence } from '@/components/domain/ExceptionEvidence'
import { PositionDisagreement } from '@/components/domain/PositionDisagreement'
import { Button } from '@/components/ui/Button'
import { useDocked } from '@/components/ui/DetailPanel'
import { Switch } from '@/components/ui/Switch'
import { Tabs, type Tab } from '@/components/ui/Tabs'
import { useAuth } from '@/lib/hooks/useAuth'
import { BatchReviewForm } from './BatchReviewForm'
import { uniqueExceptionsById } from './exception-dedupe'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'
import { exceptionRowId } from '@/components/domain/ExceptionRow'
import { PHASE_ANCHOR_PREFIX } from './PhaseTimelineItem'
import { exceptionReviewLabel, isTripLevelException, TRIP_LEVEL_SCOPE } from '@/lib/phase/exception-rows'
import { exceptionEventTime } from '@/lib/phase/acts'
import { fmtExceptionType } from '@/lib/format/exception'
import { CompactActLine, COMPACT_COLUMNS, COMPACT_HIT_AREA, COMPACT_SUBGRID } from '@/components/domain/CompactActLine'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'

export type ExceptionFilter = 'needs_review' | 'reviewed' | 'all'
export type ExceptionGrouping = 'none' | 'phase'
export type ExceptionDensity = 'detailed' | 'compact'
/** One sortable key today (event time). It is a Sort<K> so a second key slots into the same
 *  sortRows / useTableSort machinery every table uses, rather than a one-off boolean. */
export type ExceptionRecordSortKey = 'time'
export const EXCEPTION_RECORD_SORT_KEYS: readonly ExceptionRecordSortKey[] = ['time']
export const DEFAULT_EXCEPTION_RECORD_SORT: Sort<ExceptionRecordSortKey> = { key: 'time', dir: 'desc' }
/** A date starts newest first; a second click reverses it. */
export const firstExceptionRecordDir = (): 'desc' => 'desc'
const SORT_LABELS = { desc: 'Newest first', asc: 'Oldest first' } as const
const DENSITY_TABS: readonly Tab[] = [{ id: 'compact', label: 'Compact' }, { id: 'detailed', label: 'Detailed' }]
const DENSITY_TABS_PREFIX = 'exception-density'
// Not exceptionRowId's prefix: the timeline owns `exception-row-<id>` (Show in timeline scrolls to
// it, and the click-off and focus rules key on it), so a second element wearing it would hijack both.
const COMPACT_ROW_ID_PREFIX = 'exception-panel-row-'
// Anything the reader can act on or read closely keeps an open card from collapsing: its own links and
// buttons ("Review exception", "View on map", "Show in timeline"), the supporting-evidence disclosure and
// the photos inside it. A dialog opened from the card (the map) sits inside it in the DOM, so a click in
// that dialog would otherwise collapse the card, and the dialog with it.
const KEEP_OPEN_TARGETS = 'a, button, summary, details, img, input, select, textarea, dialog, [role="button"]'
const FILTER_TABS_PREFIX = 'exception-filter'
// Filters name a review_status; 'all' is the only one that also keeps 'recorded' rows (nothing owed).
const FILTER_STATUS = { needs_review: 'needs_review', reviewed: 'reviewed' } as const
const EMPTY_MESSAGES: Record<ExceptionFilter, string> = {
  needs_review: 'No exceptions need review.',
  reviewed: 'No exceptions have been reviewed.',
  all: 'No exceptions recorded.',
}
const RECORDS_PANEL_ID = 'exception-records'
interface Props {
  trip: Trip; precincts: Precinct[]; filter: ExceptionFilter; onFilter: (filter: ExceptionFilter) => void; returnTo: string
  /** Owned by TripDetailPanel, not this panel: switching to Info and back unmounts this one,
   *  and a dispatcher's grouping choice should survive that. */
  grouping?: ExceptionGrouping
  onGrouping?: (grouping: ExceptionGrouping) => void
  density?: ExceptionDensity
  onDensity?: (density: ExceptionDensity) => void
  sort?: Sort<ExceptionRecordSortKey>
  /** Takes a column id, as useTableSort's onSort does. */
  onSort?: (columnId: string) => void
  /** The trip's artifacts by id, so an exception's supporting photo can be shown here
   *  (the timeline card that used to carry it is going away). */
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  selectedPhaseId?: string | null
  invalidPhaseId?: string | null
  /** The one record the panel was opened on (`exception=<id>` in the URL), already known
   *  to belong to this trip. */
  selectedExceptionId?: string | null
  /** An `exception` id in the URL that is not on this trip. */
  invalidExceptionId?: string | null
  onClearPhaseFilter?: () => void
  onClearExceptionSelection?: () => void
  /** The record's own id travels with its phase (null for a trip-level record), so the timeline can reveal that row. */
  onShowInTimeline?: (exceptionId: string, phaseId: string | null) => void
}
export function TripExceptionsPanel({ trip, precincts, filter, artifactsById, selectedPhaseId = null, invalidPhaseId = null, selectedExceptionId = null, invalidExceptionId = null, grouping = 'none', onGrouping, density = 'detailed', onDensity, sort = DEFAULT_EXCEPTION_RECORD_SORT, onSort, onFilter, onClearPhaseFilter, onClearExceptionSelection, onShowInTimeline, returnTo }: Props) {
  // Docked, this panel is DetailPanel's own `bg-surf-low` <aside>, a 'low' card there
  // is the exact same tone as its own container, indistinguishable but for a faint
  // border. Below the dock width it renders inside Modal instead, whose background is
  // already the 'lowest' tone (pure white, same value as bg-surf-lowest), a 'lowest'
  // card there would have the identical blending problem in the other direction. Each
  // context needs the tone its OWN container is not.
  const docked = useDocked()
  const tone = docked ? 'lowest' : 'low'
  const { user } = useAuth()
  const [batchSelection, setBatchSelection] = useState<{tripId: string; rows: TripException[]} | null>(null)
  const batchOpen = batchSelection?.tripId === trip.id
  // Compact rows open in place. The row that was clicked unmounts as its card mounts, so focus is
  // handed across explicitly, and back again on collapse, or a keyboard reader lands on <body>.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const focusRequest = useRef<{ id: string; target: 'card' | 'row' } | null>(null)
  useEffect(() => {
    const request = focusRequest.current
    if (!request) return
    focusRequest.current = null
    const target = request.target === 'card'
      ? document.querySelector<HTMLElement>(`[data-exception-id="${CSS.escape(request.id)}"]`)
      : document.getElementById(`${COMPACT_ROW_ID_PREFIX}${request.id}`)
    target?.focus()
  }, [expandedIds])
  const selectedRef = useRef<HTMLDivElement>(null)
  // Scroll once per selection, not per render: a polling refetch hands this panel a new
  // trip object every few seconds, and re-running on that would drag a reader who has
  // scrolled on back to the record. The frame wait is for the overlay: Modal calls
  // showModal() in its own effect, which runs after this one (children first), and a
  // dialog that is not yet open has no layout to scroll within.
  //
  // Docked, the panel is a column after the whole timeline, so a keyboard reader who picked a
  // row would otherwise Tab through every card to reach the record (A1). Focus follows only when
  // a timeline row made the selection: a deep link or a reload leaves focus where the page put
  // it. The overlay has its own focus trap and needs none of this.
  useEffect(() => {
    if (!selectedExceptionId) return
    const fromTimelineRow = docked && document.activeElement?.id.startsWith(exceptionRowId('')) === true
    const frame = window.requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'center' })
      if (fromTimelineRow) selectedRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
    // `docked` is read for this selection only; resizing across the dock width is not a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExceptionId])
  if (invalidPhaseId || invalidExceptionId) {
    return <div className="space-y-3">
      {invalidPhaseId && <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
        <p>This phase filter is not part of this trip.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Clear phase filter</Button>
      </div>}
      {invalidExceptionId && <div role="status" className="rounded-lg border border-warn/30 bg-warn-c/30 p-4 text-sm text-on-surf">
        <p>This exception is not part of this trip.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onClearExceptionSelection}>Show all exceptions</Button>
      </div>}
    </div>
  }

  const tripExceptions = uniqueExceptionsById(trip.exceptions)
  const tripLevel = selectedPhaseId === TRIP_LEVEL_SCOPE
  const phaseIds = new Set(trip.phases.map(phase => phase.phase_event_id))
  const scopedExceptions = selectedPhaseId
    ? tripExceptions.filter(exception => tripLevel ? isTripLevelException(exception, phaseIds) : exception.phase_event_id === selectedPhaseId)
    : tripExceptions
  // Ordered by event time (the supporting photo's capture time when there is one), the same instant the
  // compact rows print and the timeline orders by. Id breaks ties so equal times never shuffle on refetch.
  const sortRecords = (rows: readonly TripException[]): TripException[] =>
    sortRows(rows, sort, exception => Date.parse(exceptionEventTime(exception, artifactsById)), (a, b) => compareText(a.id, b.id))
  const exceptions = sortRecords(scopedExceptions.filter(e => filter === 'all' || e.review_status === FILTER_STATUS[filter]))
  const needsReview = scopedExceptions.filter(e => e.review_status === 'needs_review').length
  const reviewed = scopedExceptions.filter(e => e.review_status === 'reviewed').length
  // Only what a dispatcher can sign for without deciding about a colleague's work or a
  // critical event: critical rows always get their own look, and a colleague's claim is
  // theirs to release or for this dispatcher to take over deliberately on the detail page.
  const batchable = sortRecords(scopedExceptions.filter(e =>
    e.review_status === 'needs_review'
    && e.severity !== 'critical'
    && (e.claimed_by_user_id === null || e.claimed_by_user_id === user?.id)))
  // A record the URL selected but the phase filter excludes would otherwise open the panel
  // on nothing, with no sign of why; say so and offer the way out.
  const selectedOutsideScope = selectedExceptionId !== null && !scopedExceptions.some(e => e.id === selectedExceptionId)
  const filteredPhase = selectedPhaseId && !tripLevel ? trip.phases.find(p => p.phase_event_id === selectedPhaseId) : undefined
  const phaseFilterLabel = tripLevel ? 'Trip-level records'
    : filteredPhase ? `${PHASE_NAMES[filteredPhase.phase_type]} · ${phaseStopLabel(trip, filteredPhase, precincts)}`
    : 'Selected phase'
  const filterTabs: readonly Tab[] = [
    { id: 'needs_review', label: 'Unreviewed', badge: String(needsReview), badgeUrgent: needsReview > 0 },
    { id: 'reviewed', label: 'Reviewed', badge: String(reviewed) },
    { id: 'all', label: 'All', badge: String(scopedExceptions.length) },
  ]
  return <div>
    {selectedOutsideScope && <p role="status" className="mb-4 rounded-lg border border-warn/30 bg-warn-c/30 p-3 text-sm text-on-surf">The selected exception is outside this phase filter.</p>}
    {selectedPhaseId && <div className="mb-4 rounded-lg border border-outline-v/30 bg-surf-low p-3 text-sm text-on-surf">
      {/* Names the phase the way the group headers do, so the filter says what it is filtering to. */}
      <p className="font-semibold">{phaseFilterLabel}</p>
      <p className="text-on-surf-v">{scopedExceptions.length} of {tripExceptions.length} trip exceptions</p>
      <Button className="mt-2" variant="secondary" size="sm" onClick={onClearPhaseFilter}>Show all {tripExceptions.length}</Button>
    </div>}
    {/* Each filter states its own size. Without it the unselected one is a blind click -
        a dispatcher looking at two rows had no way to tell whether "All" held
        another ten or the same two, which is the question the button is there to answer. */}
    {/* Filters still leave the single-record view by their own action (page.tsx onFilter); the
        attribute only stops the click-off rule from navigating a second time. */}
    {/* Counts are strings because Tabs hides a numeric 0, and "Unreviewed 0" is a fact worth showing. */}
    <div className="mb-4" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>
      <Tabs tabs={filterTabs} active={filter} onChange={id => { if (id === 'needs_review' || id === 'reviewed' || id === 'all') onFilter(id) }}
        size="sm" fit="content" ariaLabel="Exception filters" panelId={RECORDS_PANEL_ID} idPrefix={FILTER_TABS_PREFIX} />
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>
      <Tabs tabs={DENSITY_TABS} active={density} onChange={id => { if (id === 'detailed' || id === 'compact') onDensity?.(id) }}
        size="sm" className="w-44 max-w-full" ariaLabel="Record density" panelId={RECORDS_PANEL_ID} idPrefix={DENSITY_TABS_PREFIX} />
      <label className="ml-auto flex items-center gap-2 text-xs text-on-surf-v">
        Group by phase
        <Switch checked={grouping === 'phase'} onCheckedChange={on => onGrouping?.(on ? 'phase' : 'none')} ariaLabel="Group by phase" />
      </label>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}>
      {batchable.length > 0 && batchable.length <= EXCEPTION_BATCH_LIMIT && <Button variant="secondary" size="sm" onClick={() => setBatchSelection(batchOpen ? null : {tripId:trip.id, rows:batchable})} aria-expanded={batchOpen}>
        Review {batchable.length} {batchable.length === 1 ? 'warning' : 'warnings'}
      </Button>}
      <Button className="ml-auto" variant="ghost" size="sm" onClick={() => onSort?.(sort.key)} aria-label={`${SORT_LABELS[sort.dir]}, reverse order`}
        iconLeft={sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />}>
        {SORT_LABELS[sort.dir]}
      </Button>
    </div>
    {batchable.length > EXCEPTION_BATCH_LIMIT && <p className="mb-4 text-sm text-on-surf-v">Narrow to a phase with at most {EXCEPTION_BATCH_LIMIT} eligible records before batch review.</p>}
    {batchOpen && batchSelection && <BatchReviewForm
      tripId={trip.id}
      exceptions={batchSelection.rows}
      excludedCount={needsReview - batchable.length}
      key={trip.id}
      onDone={() => setBatchSelection(null)}
      onCancel={() => setBatchSelection(null)}
    />}
    <div id={RECORDS_PANEL_ID} role="tabpanel" aria-labelledby={`${FILTER_TABS_PREFIX}-${filter}`}>
      {!exceptions.length && <p className="py-5 text-sm text-on-surf-v">{EMPTY_MESSAGES[filter]}</p>}
      <div className={density === 'compact' ? '' : 'space-y-3'}>{renderRecords()}</div>
    </div>
  </div>

  function renderException(exception: TripException) {
      const selected = exception.id === selectedExceptionId
      // A compact record the reader opened, as opposed to the one the URL selected.
      const expanded = density === 'compact' && expandedIds.has(exception.id)
      // The URL-selected record stays open: its way out is click-off or Escape, which also change the URL.
      const collapsible = expanded && !selected
      const phase = trip.phases.find(p => p.phase_event_id === exception.phase_event_id)
      const precinct = phase ? precinctAtPhase(trip, phase, precincts) : undefined
      const mapEvidence = hasExceptionMapEvidence(exception, phase, precinct)
      // A position finding compares the linked phase's own fixes, so it needs the phase;
      // a photo or fix on the record itself does not.
      const showsPositions = exception.exception_type === 'gps_mismatch' && phase !== undefined
      const hasSupportingEvidence = showsPositions || exceptionHasEvidence(exception)
      // Every record can be shown on the timeline, so the footer is never empty: the map and the
      // supporting evidence are what vary.
      const footer = <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* The map comes first: for a position finding it answers the dispatcher's
              first question ("how far off?") before any navigation does. */}
          {mapEvidence && <ExceptionMapButton exception={exception} phase={phase} precinct={precinct} />}
          {/* A trip-level record has no phase, but it has a row in the timeline's "Trip record" list. */}
          <Button variant="ghost" size="sm" onClick={() => onShowInTimeline?.(exception.id, phase?.phase_event_id ?? null)}>Show in timeline</Button>
        </div>
        {hasSupportingEvidence && <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-sec">Supporting evidence</summary>
          <div className="mt-3">
            {showsPositions && (
              // The panel's own map button above already draws a driver-raised finding from
              // its snapshot; the inner one is only needed when the record has none.
              <PositionDisagreement phase={phase} precinct={precinct} source={exception.source} hideMapButton={!exception.action_location_assessment} />
            )}
            <ExceptionEvidence exception={exception} artifactsById={artifactsById} />
          </div>
        </details>}
      </div>
      // The selected record is a focus target (A1), named by its exception type. Its phase card's
      // anchor lets Escape return focus to that card when the row itself is not on the timeline.
      return <div key={exception.id} ref={selected ? selectedRef : undefined} data-exception-id={exception.id} aria-current={selected ? 'true' : undefined}
        data-phase-anchor={phase ? `${PHASE_ANCHOR_PREFIX}${phase.phase_event_id}` : undefined}
        {...(selected || expanded ? { role: 'group', 'aria-labelledby': exceptionSummaryTitleId(exception.id), tabIndex: collapsible ? 0 : -1 } : {})}
        {...(collapsible ? {
          onClick: (event: React.MouseEvent<HTMLElement>) => collapseOnCardClick(event, exception.id),
          onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => collapseOnKey(event, exception.id),
          [KEEP_EXCEPTION_SELECTION_ATTR]: true,
        } : {})}
        className={`rounded-lg ${density === 'compact' ? 'my-2' : ''} ${collapsible ? 'cursor-pointer' : ''} [&_time]:text-on-surf-v focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec`}>
        <ExceptionSummary
          exception={exception}
          phaseLabel={phase ? PHASE_NAMES[phase.phase_type] : 'Trip record'}
          returnTo={returnTo}
          tone={tone}
          selected={selected}
          footer={footer}
        />
      </div>
  }
  function collapseOnCardClick(event: React.MouseEvent<HTMLElement>, exceptionId: string) {
    const target = event.target
    // A modal opened from the card (the map) is a React child but not a DOM child: its clicks bubble
    // here too, and must not collapse the card behind it.
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    const control = target.closest(KEEP_OPEN_TARGETS)
    if (control && event.currentTarget.contains(control)) return
    // Dragging to select text (a coordinate to copy) ends in a click; that is reading, not collapsing.
    const textSelection = window.getSelection()
    if (textSelection && !textSelection.isCollapsed) return
    collapse(exceptionId)
  }
  // Only when the card itself has focus: Enter on one of its buttons is that button's own action.
  function collapseOnKey(event: React.KeyboardEvent<HTMLElement>, exceptionId: string) {
    if (event.target !== event.currentTarget || !['Enter', ' ', 'Escape'].includes(event.key)) return
    event.preventDefault()
    collapse(exceptionId)
  }
  function expand(exceptionId: string) {
    setExpandedIds(previous => new Set(previous).add(exceptionId))
    focusRequest.current = { id: exceptionId, target: 'card' }
  }
  function collapse(exceptionId: string) {
    setExpandedIds(previous => { const next = new Set(previous); next.delete(exceptionId); return next })
    focusRequest.current = { id: exceptionId, target: 'row' }
  }
  // One line per record, built from the timeline's compact-line primitive. ExceptionRow is not
  // reused: it carries the timeline's DOM id and its click selects the record in this panel.
  function renderCompact(exception: TripException) {
    const at = exceptionEventTime(exception, artifactsById)
    const severity = EXCEPTION_SEVERITY_META[exception.severity]
    const day = fmtSastDateParts(at)?.day
    return <div key={exception.id} className={`${COMPACT_COLUMNS} border-b border-outline-v/20`}>
      <button type="button" id={`${COMPACT_ROW_ID_PREFIX}${exception.id}`} aria-expanded={false} onClick={() => expand(exception.id)}
        {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }}
        className={`${COMPACT_SUBGRID} ${COMPACT_HIT_AREA} relative w-full rounded text-left text-on-surf hover:bg-sec-c/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec`}>
        {/* No clock label here: "System recorded" beside the time takes over half this pane's width
            and wraps every row to four lines. The opened card still names its source. */}
        <CompactActLine times={[{ at, source: null }]} icon="warn" iconClassName="text-warn">
          <span className="font-semibold">{fmtExceptionType(exception.exception_type)}</span>
          <span className="block text-on-surf-v">{severity.label} · {exceptionReviewLabel(exception)}{day && ` · ${day}`} · <ExceptionRef id={exception.id} /></span>
        </CompactActLine>
      </button>
    </div>
  }
  // The selected record is always the full card: it is what the panel was opened on.
  function renderRow(exception: TripException) {
    const open = exception.id === selectedExceptionId || expandedIds.has(exception.id)
    return density === 'compact' && !open ? renderCompact(exception) : renderException(exception)
  }
  function renderRecords() {
    if (grouping === 'none') return exceptions.map(renderRow)
    const groups = new Map<string, TripException[]>()
    for (const exception of exceptions) {
      const key = exception.phase_event_id ?? 'trip-level'
      groups.set(key, [...(groups.get(key) ?? []), exception])
    }
    // `exceptions` is already sorted, so a Map's insertion order puts each group where its first record falls.
    return [...groups.entries()].map(([key, rows]) => {
      const phase = trip.phases.find(p => p.phase_event_id === key)
      // The phase's name and its stop (the timeline's own wording), not its event id: the id told a
      // dispatcher nothing, and the stop is what tells two phases of one type apart on a multi-stop trip.
      const title = key === 'trip-level' ? 'Trip-level records' : phase ? PHASE_NAMES[phase.phase_type] : `Recorded phase ${key}`
      const stop = phase ? phaseStopLabel(trip, phase, precincts) : null
      return <section key={key} data-phase-group={key} className="space-y-3">
        <div className="flex items-start justify-between gap-3 border-b border-outline-v/30 py-3">
          <div className="min-w-0 break-words [overflow-wrap:anywhere]">
            <h3 className="text-sm font-semibold">{title}</h3>
            {stop && <p className="text-xs text-on-surf-v">{stop}</p>}
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-on-surf-v" aria-label={`${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}>{rows.length}</span>
        </div>
        {rows.map(renderRow)}
      </section>
    })
  }
}
