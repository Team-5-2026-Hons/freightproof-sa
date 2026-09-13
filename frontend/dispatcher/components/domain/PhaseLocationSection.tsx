import { Section } from './PhaseDetailFields'
import { LocationEvidencePanel } from './LocationEvidencePanel'
import { locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  // The precinct this phase is anchored to. Undefined when the stop or precinct cannot be
  // resolved — distances are then omitted rather than computed against a guess.
  precinct: Precinct | undefined
  title?: string
}

/**
 * Where the driver's phone and the truck each were when this phase completed, and the
 * stored geofence verdict: as recorded, never recomputed.
 *
 * Shared by activation, departure and confirmation. All three ask the same question, so
 * they ask it in the same words, and a fix to the location display lands in one place.
 *
 * Previously computed a live offset against the CURRENT precinct boundary and rendered it
 * as "Awaiting Pulsit / Confirmed ✓ / Mismatch ✗". That was misleading history: a precinct's
 * geofence radius can change after the fix was captured, so a browser-computed offset
 * against today's boundary was quietly grading a historical fix against a fence that may
 * not have existed when it was recorded. `locationEvidenceForPhase` now draws the CURRENT
 * boundary as an explicitly labelled reference only, and shows the verdict the backend
 * actually stored: see BOUNDARY_REFERENCE_LABEL in lib/phase/location-evidence.ts.
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
