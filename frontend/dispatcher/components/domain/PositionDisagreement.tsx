import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { LocationEvidencePanel } from './LocationEvidencePanel'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { ExceptionSource } from '@shared/lib/types/exception'

export interface PositionDisagreementProps {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  // The trigger sentence below states a verdict the SYSTEM's own tracker fix produced;
  // it must never be shown for a driver-raised gps_mismatch (DriverExceptionCreateBody
  // lets a driver submit that exception_type too), since a driver row carries no such
  // tracker verdict. Required, not defaulted, so a caller can't forget to pass it and
  // silently render an unearned trigger line.
  source: ExceptionSource
  /** Forwarded to the inner LocationEvidencePanel: suppresses its "View on map" button
   *  for a caller that already shows an equivalent button elsewhere on the same card.
   *  Defaults to false. */
  hideMapButton?: boolean
}

// The backend raises `gps_mismatch` ONLY when the vehicle tracker's own fix fell outside
// the stop's geofence (`pulsit_geofence_confirmed is False`); there is no phone-vs-tracker
// disagreement rule on the backend. Exported so the exception-detail page states the same
// trigger in the same words rather than drifting into its own paraphrase of the fact.
export const GPS_MISMATCH_TRIGGER = 'Vehicle tracker outside the facility boundary'

const LINKED_PHASE_LOCATIONS_LABEL = 'Linked phase locations'
const PHASE_NOT_COMPLETED = 'Phase not completed'
// These fixes belong to the PHASE the exception is linked to, captured when the phase
// itself completed, never a separate position recorded for the exception. Says so
// explicitly so a dispatcher does not mistake a phase fix for the exception's own moment.
const LINKED_PHASE_LOCATIONS_NOTE =
  "These are the phase's own recorded fixes, captured when the phase completed, not a separate position for this exception."

/**
 * The evidence behind a `gps_mismatch` exception: the stored trigger (the vehicle
 * tracker fell outside the stop's geofence, the only rule the backend actually applies),
 * followed by the linked phase's own recorded location fixes, shown as context.
 *
 * The driver phone vs. vehicle tracker separation rendered inside the panel below is an
 * accompanying measurement, never the reason for the exception: there is no
 * phone-vs-tracker disagreement rule on the backend, and presenting the separation as a
 * "reason" would misrepresent what was actually checked. The trigger line above states
 * the stored tracker verdict explicitly so the two can never be confused.
 */
export function PositionDisagreement({ phase, precinct, source, hideMapButton = false }: PositionDisagreementProps) {
  const evidence = locationEvidenceForPhase(phase, precinct)
  const contextLabel = `${LINKED_PHASE_LOCATIONS_LABEL}: ${PHASE_NAMES[phase.phase_type]}${precinct ? ` at ${precinct.name}` : ''}`

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20">
      {/* Only a system-raised exception carries the tracker's own geofence verdict: a
          driver-raised gps_mismatch has no such fix to assert this sentence about. The
          "Linked phase locations" panel below still renders either way: it shows the
          phase's own recorded fixes, which exist independently of who raised the exception. */}
      {source === 'system' && (
        <p data-testid="gps-mismatch-trigger" className="text-[12px] font-[700] text-on-surf">
          {GPS_MISMATCH_TRIGGER}
        </p>
      )}
      <div className="mt-3">
        <div className="text-[11px] font-[700] text-sec">
          {LINKED_PHASE_LOCATIONS_LABEL} · {phase.completed_at ? fmtDateTime(phase.completed_at) : PHASE_NOT_COMPLETED}
        </div>
        <p className="mt-[2px] text-[11px] text-on-surf-v">{LINKED_PHASE_LOCATIONS_NOTE}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-[5px]">
        <LocationEvidencePanel evidence={evidence} contextLabel={contextLabel} hideMapButton={hideMapButton} />
      </div>
    </div>
  )
}
