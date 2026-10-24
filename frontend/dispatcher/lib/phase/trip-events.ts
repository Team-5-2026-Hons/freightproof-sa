import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { IncidentSummary } from '@/lib/types/incident'
import { positionTimelineEvents, type TimelinePlacement } from './driver-transfers'

/** A dated record the timeline draws between phase cards, not inside one. */
export type TripTimelineEvent =
  | { kind: 'transfer'; transfer: CompletedSubstitutionSummary }
  | { kind: 'incident'; incident: IncidentSummary }

/** When an incident happened, as far as anyone knows: what the reporter said, else when we heard. */
export function incidentEventTime(incident: IncidentSummary): string {
  return incident.reported_occurred_at ?? incident.received_at
}

function eventTime(event: TripTimelineEvent): string {
  return event.kind === 'transfer' ? event.transfer.effective_at : incidentEventTime(event.incident)
}

function eventKey(event: TripTimelineEvent): string {
  return event.kind === 'transfer' ? `transfer:${event.transfer.substitution_id}` : `incident:${event.incident.incident_id}`
}

// At one instant a transfer reads before an incident; two transfers keep their recorded sequence.
function tieBreak(a: TripTimelineEvent, b: TripTimelineEvent): number {
  if (a.kind !== b.kind) return a.kind === 'transfer' ? -1 : 1
  return a.kind === 'transfer' && b.kind === 'transfer' ? a.transfer.sequence_number - b.transfer.sequence_number : 0
}

/** Driver transfers and incidents on one shared clock, so a slot holding both reads in time order. */
export function positionTripEvents(
  phases: readonly PhaseDescriptor[],
  transfers: readonly CompletedSubstitutionSummary[],
  incidents: readonly IncidentSummary[],
): TimelinePlacement<TripTimelineEvent> {
  const events: TripTimelineEvent[] = [
    ...transfers.map((transfer): TripTimelineEvent => ({ kind: 'transfer', transfer })),
    ...incidents.map((incident): TripTimelineEvent => ({ kind: 'incident', incident })),
  ]
  return positionTimelineEvents(phases, events, eventTime, eventKey, tieBreak)
}
