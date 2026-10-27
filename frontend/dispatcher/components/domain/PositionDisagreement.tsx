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
  source: ExceptionSource
  hideMapButton?: boolean
}

export const GPS_MISMATCH_TRIGGER = 'Vehicle tracker outside the facility boundary'

const LINKED_PHASE_LOCATIONS_LABEL = 'Linked phase locations'
const PHASE_NOT_COMPLETED = 'Phase not completed'
const LINKED_PHASE_LOCATIONS_NOTE =
  "These are the phase's own recorded fixes, captured when the phase completed, not a separate position for this exception."

/**
 * Shows the evidence behind a `gps_mismatch` exception: the stored trigger (tracker
 * outside the geofence, the only rule the backend applies) plus the linked phase's own
 * location fixes as context. The phone-vs-tracker separation rendered by the panel below
 * is a measurement, not the reason for the exception — keep the two distinct.
 */
export function PositionDisagreement({ phase, precinct, source, hideMapButton = false }: PositionDisagreementProps) {
  const evidence = locationEvidenceForPhase(phase, precinct)
  const contextLabel = `${LINKED_PHASE_LOCATIONS_LABEL}: ${PHASE_NAMES[phase.phase_type]}${precinct ? ` at ${precinct.name}` : ''}`

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20">
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
