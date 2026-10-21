// The one-line summaries a trip Info section shows beside its title while it is folded away, so
// the state that matters (late, handover pending, an incident open) is readable without opening it.

import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { IncidentStatus, IncidentSummary } from '@/lib/types/incident'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'
import { isTerminalTrip, precinctLabel } from '@/lib/phase/trip-detail'

export const NOT_DEPARTED = 'Not departed'
export const TRANSFER_PENDING = 'Transfer pending'
export const NO_INCIDENTS = 'None'
export const INCIDENTS_LOADING = 'Loading…'
export const AUDIT_SUMMARY = 'For insurers, clients and SAPS'

const MINUTES_ON_TIME = 0

/** "Departed 1 h 11 m late", "Departed on time", "Not departed"; or "Cancelled 21 Oct 2026" /
 *  "Closed 21 Oct 2026" once the trip has ended, since how late it left no longer matters. */
export function scheduleSummary(trip: Trip): string {
  if (isTerminalTrip(trip)) {
    const verb = trip.status === 'cancelled' ? 'Cancelled' : 'Closed'
    const day = fmtSastDateParts(trip.closed_at)?.day
    return day ? `${verb} ${day}` : verb
  }
  if (!trip.actual_departure_at) return NOT_DEPARTED
  const delay = delayMinutes(trip.planned_departure_at, trip.actual_departure_at)
  if (delay === null) return 'Departed'
  return delay === MINUTES_ON_TIME ? 'Departed on time' : `Departed ${fmtDelay(delay)}`
}

/** "3 stops · Durban Depot → Johannesburg DC". */
export function routeSummary(trip: Trip, precincts: readonly Precinct[]): string {
  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
  const first = stops[0]
  const last = stops.at(-1)
  const count = `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`
  if (!first || !last) return count
  const label = (precinctId: string): string => precinctLabel(precincts.find(p => p.id === precinctId))
  return `${count} · ${label(first.precinct_id)} → ${label(last.precinct_id)}`
}

/** Whether a handover is waiting on a decision: what opens Driver & custody and puts a chip in its summary. */
export function hasPendingTransfer(trip: Trip): boolean {
  return (trip.pending_driver_substitution ?? null) !== null
}

/** "Transfer pending", or "Ciaran Formby · 2 handovers". */
export function custodySummary(trip: Trip): string {
  if (hasPendingTransfer(trip)) return TRANSFER_PENDING
  const handovers = (trip.driver_substitutions ?? []).filter(request => request.state === 'completed').length
  const count = handovers === 0 ? 'no handovers' : `${handovers} ${handovers === 1 ? 'handover' : 'handovers'}`
  return `${trip.driver?.full_name ?? 'Driver not recorded'} · ${count}`
}

/** The most urgent status among the incidents still being worked (open before investigating), or null when
 *  every one is closed. The Incidents chip wears this status's own colour, so it never disagrees with the row. */
export function leadingActiveIncidentStatus(incidents: readonly IncidentSummary[]): Exclude<IncidentStatus, 'closed'> | null {
  if (incidents.some(incident => incident.status === 'open')) return 'open'
  return incidents.some(incident => incident.status === 'investigating') ? 'investigating' : null
}

/** Whether any incident is open or investigating: what opens Incidents and puts a chip in its summary. */
export function hasActiveIncident(incidents: readonly IncidentSummary[]): boolean {
  return incidents.some(incident => incident.status !== 'closed')
}

/** "1 open", "2 investigating", "1 open · 2 investigating", "3 closed" or "None". */
export function incidentsSummary(incidents: readonly IncidentSummary[], isLoading: boolean): string {
  if (incidents.length === 0) return isLoading ? INCIDENTS_LOADING : NO_INCIDENTS
  const count = (status: IncidentSummary['status']): number => incidents.filter(incident => incident.status === status).length
  const open = count('open')
  const investigating = count('investigating')
  const parts = [open > 0 && `${open} open`, investigating > 0 && `${investigating} investigating`].filter((part): part is string => part !== false)
  return parts.length > 0 ? parts.join(' · ') : `${count('closed')} closed`
}
