'use client'

import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'
import type { ExceptionRowData, OpenException } from '@/components/domain/ExceptionRow'
import { PhaseActs, type EvidenceLookup } from '@/components/domain/PhaseActs'
import { PhaseVerdictLine } from '@/components/domain/PhaseVerdictLine'
import { TripCreatedDetail } from '@/components/domain/TripCreatedDetail'
import { buildPhaseCardModel, type PhaseCardModel } from '@/lib/phase/card'
import { isResolved, nodeTypeFor } from '@/lib/phase/derive'
import { exceptionCountLabel, visibleExceptions } from '@/lib/phase/exception-rows'
import { currentTripPhase, phaseStopLabel, precinctAtPhase, precinctLabel } from '@/lib/phase/trip-detail'
import { PhaseCardBody, type RecordedProps } from './PhaseCardBody'
import { nextTripStop } from './PhaseEvidence'
import { PHASE_ANCHOR_PREFIX, TIMELINE_TOOLBAR_HEIGHT_VAR, PhaseTimelineItem } from './PhaseTimelineItem'
import { tripEventReasons, type TripTimelineEvent } from '@/lib/phase/trip-events'
import type { TripEventHandlers } from '@/components/domain/TripEventRow'

const ANCHOR_FAILED_WARNING = 'Anchor failed, receipt still owed'

interface Props {
  trip: Trip
  phase: PhaseDescriptor
  precincts: Precinct[]
  isLast: boolean
  /** This phase's exceptions: de-duplicated, scoped to it and in chronological order. */
  exceptions: readonly TripException[]
  artifacts: readonly EvidenceArtifactWithUrl[]
  lookup: EvidenceLookup
  onChanged: () => void
  nowMs: number
  onOpenException: OpenException
  selectedExceptionId: string | null
  highlightedExceptionId: string | null
  /** A "Show in timeline" addressed to this phase: opens the card and keeps its row visible. */
  reveal: { exceptionId: string; requestId: number } | null
  /** Collapsed cards show a header and a verdict headline only; expanding them shows everything. */
  minimised?: boolean
  /** In Transit only: the leg's incidents and driver transfers, in time order. They join the
   *  Recorded rail by time, beside the departure, the exceptions and the arrival. */
  tripEvents?: readonly TripTimelineEvent[]
  tripEventHandlers?: TripEventHandlers
}

function receiptOf(trip: Trip, phase: PhaseDescriptor): BlockchainReceipt | undefined {
  return trip.blockchain_receipts.find(receipt => receipt.id === phase.blockchain_receipt_id)
    ?? (phase.phase_type === 'trip_creation' ? trip.blockchain_receipts.find(receipt => receipt.receipt_type === 'journey_lock') : undefined)
}

/** The exception acts, joined to their records, in the order the rail shows them. */
function exceptionRowsOf(model: PhaseCardModel, byId: ReadonlyMap<string, TripException>): ExceptionRowData[] {
  return model.acts.flatMap(act => {
    const exception = act.kind === 'exception' ? byId.get(act.exceptionId) : undefined
    return exception && act.kind === 'exception' ? [{ exception, at: act.at }] : []
  })
}

/**
 * One phase of the timeline: the card shell, the verdict in its header, the exception rows under
 * it while collapsed, and the three zones as its body. This is where the pure model meets the
 * components; trip_creation keeps its own detail panel and has no verdict this round.
 */
export function TimelinePhase(props: Props): React.JSX.Element {
  const { trip, phase, precincts, exceptions, lookup, reveal, minimised = false } = props
  const model = buildPhaseCardModel({ trip, phase, precincts, artifacts: props.artifacts, exceptions, receipt: receiptOf(trip, phase), nowMs: props.nowMs, tripEvents: props.tripEvents })
  const baseNode = nodeTypeFor(phase, currentTripPhase(trip)?.phase_event_id ?? null, trip.status)
  const exceptionsById = new Map(exceptions.map(exception => [exception.id as string, exception]))
  const rows = exceptionRowsOf(model, exceptionsById)
  // A row the cap would hide is swapped in when "Show in timeline" asks for it (D42).
  const { visibleIds, hiddenCount } = visibleExceptions(rows.map(row => row.exception), reveal?.exceptionId ?? null)
  const phaseName = PHASE_NAMES[phase.phase_type]
  const isTransit = phase.phase_type === 'in_transit'
  const live = model.isActive && model.running

  const recorded: RecordedProps = {
    stopName: precinctLabel(precinctAtPhase(trip, phase, precincts)),
    destinationName: isTransit ? precinctLabel(precincts.find(p => p.id === nextTripStop(trip, phase)?.precinct_id)) : '',
    expectedArrivalAt: trip.planned_arrival_at,
    lookup,
    exceptionsById,
    visibleExceptionIds: visibleIds,
    hiddenExceptionCount: hiddenCount,
    selectedExceptionId: props.selectedExceptionId,
    highlightedExceptionId: props.highlightedExceptionId,
    onOpenException: props.onOpenException,
    tripEvents: props.tripEventHandlers,
  }
  const body = phase.phase_type === 'trip_creation'
    ? <><PhaseActs {...recorded} acts={model.acts} phase={phase} live={false} /><TripCreatedDetail trip={trip} /></>
    : model.hasBody && (
      <PhaseCardBody
        trip={trip} phase={phase} model={model} precincts={precincts} receipt={receiptOf(trip, phase)} recorded={recorded}
        slotTime={trip.stops.find(stop => stop.id === phase.trip_stop_id)?.slot_time ?? null}
        onChanged={props.onChanged}
      />
    )
  const meta = isTransit ? `${recorded.stopName} → ${recorded.destinationName}` : phaseStopLabel(trip, phase, precincts)
  const warning = phase.anchor_status === 'failed' ? ANCHOR_FAILED_WARNING : undefined
  const compactActs = !isTransit && model.acts.length > 0
  // A phase with no verdict (trip creation) has no header line to carry the count, so minimised
  // says it here; every other minimised card carries it in its verdict.
  // A hijacking is the loudest record on the trip: minimised still lists the leg's incidents and
  // transfers as one-line rows, so collapsing the card never hides one.
  const tripEventActs = model.acts.filter(act => act.kind === 'trip_event')
  const collapsedEvents = minimised && tripEventActs.length > 0
    ? <PhaseActs {...recorded} acts={tripEventActs} phase={phase} live={false} density="compact" /> : undefined
  const baseCollapsed = minimised
    ? (!model.verdict && exceptions.length > 0 ? <p className="mt-1.5 text-body font-semibold text-warn">{exceptionCountLabel(exceptions)}</p> : undefined)
    : compactActs ? <PhaseActs {...recorded} acts={model.acts} phase={phase} live={false} density="compact" /> : undefined
  const collapsedContent = collapsedEvents ? <>{baseCollapsed}{collapsedEvents}</> : baseCollapsed

  return (
    <div id={`${PHASE_ANCHOR_PREFIX}${phase.phase_event_id}`} role="group" aria-label={`${phaseName} phase${exceptions.length ? ' and exceptions' : ''}`} style={{ scrollMarginTop: `var(${TIMELINE_TOOLBAR_HEIGHT_VAR}, 0px)` }} className="min-w-0">
      <PhaseTimelineItem
        number={phase.sequence_number}
        label={phaseName}
        meta={meta}
        timestamp={phase.completed_at}
        nodeType={model.verdict?.nodeType ?? baseNode}
        initialOpen={live}
        live={live}
        cancelled={trip.status === 'cancelled'}
        overridden={phase.status === 'overridden'}
        isLast={props.isLast}
        // In transit is where theft signals arrive, so it is never worth hiding (D31): open with
        // no toggle while the leg is happening and after it (completed, exception or overridden).
        // A leg not yet started or not reached has no body and stays a collapsed dashed card.
        // Minimised is the reader's explicit ask for less: there the leg collapses like any other
        // phase (still open while it is the live one), and its headline and count stay visible.
        alwaysOpen={isTransit && model.hasBody && !minimised}
        verdict={model.verdict ? <PhaseVerdictLine verdict={model.verdict} /> : undefined}
        // Minimised keeps the headline and how many exceptions the phase holds; the reasons and the
        // event rail are one expand away. The count is plain text: the card header is already the
        // expand button, so a second button cannot sit inside it.
        collapsedVerdict={minimised && model.verdict
          ? <PhaseVerdictLine verdict={{ ...model.verdict, reasons: [...(exceptions.length ? [exceptionCountLabel(exceptions)] : []), ...tripEventReasons(props.tripEvents ?? [])] }} /> : undefined}
        collapsedContent={collapsedContent}
        warning={warning}
        openRequestId={reveal?.requestId ?? null}
      >
        {body || undefined}
      </PhaseTimelineItem>
    </div>
  )
}
