import { Section } from './PhaseDetailFields'
import { LocationEvidencePanel } from './LocationEvidencePanel'
import { locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  // Undefined when the stop or precinct cannot be resolved — distances are then omitted.
  precinct: Precinct | undefined
  title?: string
}

/**
 * Shows where the driver's phone and truck were when the phase completed, using the
 * geofence verdict stored by the backend rather than recomputing it against the
 * current precinct boundary — see `locationEvidenceForPhase`.
 */
export function PhaseLocationSection({ phase, precinct, title = 'Observed location' }: Props) {
  const evidence = locationEvidenceForPhase(phase, precinct)
  const contextLabel = precinct
    ? `${PHASE_NAMES[phase.phase_type]} at ${precinct.name}`
    : PHASE_NAMES[phase.phase_type]

  return (
    <Section title={title}>
      <LocationEvidencePanel evidence={evidence} contextLabel={contextLabel} />
    </Section>
  )
}
