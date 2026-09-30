import { isClosedPhaseStatus, type DevTripStop, type DevTripSummary } from '@/lib/types/dev'

export type DemoStageKind =
  | 'not_started' | 'before_departure' | 'on_road' | 'arrived' | 'unloading' | 'confirming' | 'closed'

export interface DemoStage {
  kind: DemoStageKind
  /** Where the truck is. On the road: the stop it left. */
  stop: DevTripStop | null
  /** On the road only: the stop it is heading to. */
  nextStop: DevTripStop | null
  headline: string
}

const PHASE_STAGE: Readonly<Record<string, DemoStageKind>> = {
  activation: 'before_departure',
  loading: 'before_departure',
  departure: 'before_departure',
  in_transit: 'on_road',
  arrival: 'arrived',
  unloading: 'unloading',
  confirmation: 'confirming',
}

const FINISHED_STATUSES: readonly string[] = ['closed', 'cancelled']

/**
 * Where the trip is, from the ledger-derived current phase and stop. The one place that
 * decides which panel actions show, so the rule is unit-tested rather than scattered
 * across components.
 */
export function demoStageFor(trip: DevTripSummary): DemoStage {
  if (FINISHED_STATUSES.includes(trip.status)) {
    return { kind: 'closed', stop: null, nextStop: null, headline: `Trip ${trip.status}` }
  }
  const kind = trip.current_phase === null ? undefined : PHASE_STAGE[trip.current_phase]
  if (kind === undefined) {
    return { kind: 'not_started', stop: null, nextStop: null, headline: 'Waiting for the driver to activate' }
  }

  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
  const index = stops.findIndex(s => s.sequence === trip.current_stop_sequence)
  const stop = stops[index] ?? stops[0] ?? null
  const nextStop = kind === 'on_road' && index >= 0 ? stops[index + 1] ?? null : null
  const place = stop?.precinct_name ?? 'the stop'

  const headline: Record<DemoStageKind, string> = {
    not_started: '',
    closed: '',
    before_departure: `At ${place} · before departure`,
    on_road: `On the road to ${nextStop?.precinct_name ?? 'the next stop'} · leg ${index + 1} of ${stops.length - 1}`,
    arrived: `Arrived at ${place} · seal inspection`,
    unloading: `Unloading at ${place}`,
    confirming: `Handing over at ${place}`,
  }
  return { kind, stop, nextStop, headline: headline[kind] }
}

export function scanOutOpen(stop: DevTripStop): boolean {
  return stop.pickup_consignments.length > 0 && !isClosedPhaseStatus(stop.loading_phase_status)
}

/** Scan IN opens once the driver has completed arrival (seal inspected before any door
 *  opens) and stays open until confirmation decides — confirmation is where the origin
 *  and destination scans are reconciled (phase_gate.GATED_PHASES). */
export function scanInOpen(stop: DevTripStop): boolean {
  return stop.delivery_consignments.length > 0
    && isClosedPhaseStatus(stop.arrival_phase_status)
    && !isClosedPhaseStatus(stop.confirmation_phase_status)
}

/** Live trips first; the backend's newest-first order is kept within each group. */
export function sortTripsForPicker(trips: readonly DevTripSummary[]): DevTripSummary[] {
  const live = trips.filter(t => !FINISHED_STATUSES.includes(t.status))
  const finished = trips.filter(t => FINISHED_STATUSES.includes(t.status))
  return [...live, ...finished]
}
