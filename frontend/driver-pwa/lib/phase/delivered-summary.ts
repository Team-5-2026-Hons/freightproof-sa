import type { Trip } from '@shared/lib/types/trip'

export interface DeliveredSummary {
  /** When the truck arrived (ISO), or null when the ledger has no arrival yet. */
  arrivedAt: string | null
  /** Arrived by the planned time — the same no-grace rule as Home's record. Null without a plan. */
  onTime: boolean | null
  /** Driver phases (trip_creation excluded) whose Hedera receipt is back. */
  anchored: number
  total: number
}

/**
 * The facts on the "Delivered" screen (overhaul 9.5), read from the trip's own ledger:
 * the last arrival's completion, the plan's due time, and each phase's anchor status.
 */
export function deliveredSummary(trip: Trip): DeliveredSummary {
  const driverPhases = trip.phases.filter((p) => p.phase_type !== 'trip_creation')
  const arrivals = driverPhases
    .filter((p) => p.phase_type === 'arrival' && p.completed_at !== null)
    .sort((a, b) => a.sequence_number - b.sequence_number)
  const arrivedAt = trip.actual_arrival_at ?? arrivals[arrivals.length - 1]?.completed_at ?? null
  const onTime = arrivedAt === null || trip.planned_arrival_at === null
    ? null
    : Date.parse(arrivedAt) <= Date.parse(trip.planned_arrival_at)
  return {
    arrivedAt,
    onTime,
    anchored: driverPhases.filter((p) => p.anchor_status === 'anchored').length,
    total: driverPhases.length,
  }
}
