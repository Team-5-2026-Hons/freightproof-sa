import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { ParcelJourney, ParcelProgress, ParcelSealWindow, ParcelTracePhase } from '@shared/lib/types/parcel-trace'
import type { ChipType } from '@/components/ui/Chip'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'

export const BARCODE_MAX_LENGTH = 100

export const SEAL_LABELS: Record<ParcelSealWindow['status'], string> = {
  matched: 'Matching seals recorded',
  mismatch: 'Seal discrepancy recorded',
  pending: 'Inspection not yet recorded',
  unverified: 'Seal continuity unverified',
}

export const LOCATION_LABELS: Record<ParcelTracePhase['location_verdict'], string> = {
  confirmed: 'Truck within precinct tolerance',
  mismatch: 'Truck outside precinct tolerance',
  unwitnessed: 'No recorded tracker confirmation',
  not_recorded: 'Location not recorded for this step',
}

export function progressLabel(progress: ParcelProgress, phases: readonly ParcelTracePhase[] = []): string {
  if (progress.position === 'cancelled') return 'Journey cancelled'
  if (progress.position === 'unknown') return 'Consignment progress unavailable'
  if (progress.position === 'before_pickup') return 'Awaiting pickup'
  if (progress.position === 'after_delivery') return progress.has_overrides ? 'Journey resolved with an override' : 'Delivery phase recorded'
  const current = phases.find(phase => phase.id === progress.phase_event_id)
  if (current?.relevance === 'trip_context') return 'At an intermediate stop — other cargo handling'
  if (progress.phase_type === 'in_transit') return 'In transit — awaiting arrival attestation'
  const name = progress.phase_type ? PHASE_NAMES[progress.phase_type] : 'Next phase'
  return progress.phase_status === 'in_progress' ? `${name} in progress` : `Awaiting ${name.toLowerCase()}`
}

export function phaseStatus(phase: ParcelTracePhase, cancelled: boolean): { label: string; type: ChipType } {
  if (phase.status === 'overridden') return { label: 'Overridden', type: 'exception' }
  if (phase.status === 'exception') return { label: 'Exception recorded', type: 'exception' }
  if (phase.status === 'completed') return { label: 'Recorded', type: 'complete' }
  if (cancelled) return { label: 'Not reached', type: 'pending' }
  if (phase.status === 'in_progress') return { label: 'In progress', type: 'transit' }
  return { label: 'Not started', type: 'pending' }
}

export function tripEvidenceLink(tripId: string, returnTo: string, phaseId?: string): string {
  // Append the fragment LAST: returnTo is a query parameter, never part of the hash.
  const target = withReturnTo(ROUTES.tripDetail(tripId), returnTo)
  return phaseId ? `${target}#phase-${encodeURIComponent(phaseId)}` : target
}

export function locationLabel(journey: ParcelJourney): string {
  const fix = journey.last_recorded_location
  if (!fix) return 'No recorded position within this consignment’s journey'
  if (fix.precinct_confirmed === true && fix.precinct_name) return `Vehicle recorded at ${fix.precinct_name}`
  if (fix.precinct_confirmed === false && fix.precinct_name) return `Vehicle recorded outside ${fix.precinct_name} tolerance`
  return 'Position recorded — facility unverified'
}
