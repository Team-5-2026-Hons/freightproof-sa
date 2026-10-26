import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { IncidentSummary } from '@/lib/types/incident'
import { countLabel } from '@/lib/format/count'
import { positionTimelineEvents, type TimelinePlacement } from './driver-transfers'

/** A dated record the timeline draws between phase cards, or inside an In Transit card (see inPhase). */
export type TripTimelineEvent =
  | { kind: 'transfer'; transfer: CompletedSubstitutionSummary }
  | { kind: 'incident'; incident: IncidentSummary }

/** When an incident happened, as far as anyone knows: what the reporter said, else when we heard. */
export function incidentEventTime(incident: IncidentSummary): string {
  return incident.reported_occurred_at ?? incident.received_at
}

/** The instant an event sits at on the timeline. */
export function tripEventTime(event: TripTimelineEvent): string {
  return event.kind === 'transfer' ? event.transfer.effective_at : incidentEventTime(event.incident)
}

/** One stable key per record, shared by the placement de-duplication and the card's rows. */
export function tripEventKey(event: TripTimelineEvent): string {
  return event.kind === 'transfer' ? `transfer:${event.transfer.substitution_id}` : `incident:${event.incident.incident_id}`
}

// At one instant a transfer reads before an incident; two transfers keep their recorded sequence.
function tieBreak(a: TripTimelineEvent, b: TripTimelineEvent): number {
  if (a.kind !== b.kind) return a.kind === 'transfer' ? -1 : 1
  return a.kind === 'transfer' && b.kind === 'transfer' ? a.transfer.sequence_number - b.transfer.sequence_number : 0
}

export interface TripEventPlacement extends TimelinePlacement<TripTimelineEvent> {
  /** Events drawn INSIDE a phase card, keyed by that phase's id. Only In Transit cards hold any. */
  inPhase: ReadonlyMap<string, readonly TripTimelineEvent[]>
}

/** Driver transfers and incidents on one shared clock, so a slot holding both reads in time order.
 *
 *  A hijacking or a driver swap on the road happens DURING the leg, but In Transit only resolves
 *  when the truck arrives — so the plain "after the last resolved phase" rule put it after
 *  Departure, between the cards, as if it happened between legs. Any slot whose next plan phase is
 *  in_transit therefore moves inside that In Transit card: everything after departure and before
 *  arrival belongs to the leg. Events after In Transit resolved, and every other slot, stay put. */
export function positionTripEvents(
  phases: readonly PhaseDescriptor[],
  transfers: readonly CompletedSubstitutionSummary[],
  incidents: readonly IncidentSummary[],
): TripEventPlacement {
  const events: TripTimelineEvent[] = [
    ...transfers.map((transfer): TripTimelineEvent => ({ kind: 'transfer', transfer })),
    ...incidents.map((incident): TripTimelineEvent => ({ kind: 'incident', incident })),
  ]
  const placed = positionTimelineEvents(phases, events, tripEventTime, tripEventKey, tieBreak)
  const afterPhase = new Map(placed.afterPhase)
  const inPhase = new Map<string, readonly TripTimelineEvent[]>()
  phases.forEach((phase, index) => {
    const next = phases[index + 1]
    const slot = afterPhase.get(phase.phase_event_id)
    if (next?.phase_type !== 'in_transit' || !slot) return
    inPhase.set(next.phase_event_id, slot)
    afterPhase.delete(phase.phase_event_id)
  })
  return { ...placed, afterPhase, inPhase }
}

/** What a card's header says about the leg's incidents and transfers, so a hijacking is not hidden
 *  behind "No exceptions recorded" (an incident is not an exception). Incidents first: they are
 *  the records someone is still working. */
export function tripEventReasons(events: readonly TripTimelineEvent[]): string[] {
  const incidents = events.filter(event => event.kind === 'incident').length
  const transfers = events.length - incidents
  return [
    ...(incidents > 0 ? [countLabel(incidents, 'incident')] : []),
    ...(transfers === 1 ? ['Driver transferred'] : transfers > 1 ? [countLabel(transfers, 'driver transfer')] : []),
  ]
}
