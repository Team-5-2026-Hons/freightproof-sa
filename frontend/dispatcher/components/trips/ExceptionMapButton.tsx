'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { LocationComparisonModal, VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'
import { hasAnyFix, locationEvidenceForAssessment, locationEvidenceForPhase, type LocationEvidence } from '@/lib/phase/location-evidence'
import { fmtExceptionType } from '@/lib/format/exception'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

// The only exception types whose evidence IS a pair of positions. Every other type has
// nothing a map could truthfully draw.
const MAPPABLE_TYPES: readonly ExceptionType[] = ['gps_mismatch', 'driver_vehicle_separation']

interface Props {
  exception: TripException
  /** The phase the exception is linked to, when it has one. */
  phase: PhaseDescriptor | undefined
  /** The precinct that phase was expected at, for the boundary reference. */
  precinct: Precinct | undefined
}

/** Which recorded comparison this exception is about. A record that carries its own
 *  capture-time snapshot (a driver report, a checkpoint finding) is drawn from that
 *  snapshot; a phase-linked finding is drawn from the phase's own fixes, which is what
 *  the backend compared. Null when nothing was recorded to draw. */
function evidenceFor(exception: TripException, phase: PhaseDescriptor | undefined, precinct: Precinct | undefined): LocationEvidence | null {
  if (!MAPPABLE_TYPES.includes(exception.exception_type)) return null
  const evidence = exception.action_location_assessment
    ? locationEvidenceForAssessment(exception.action_location_assessment, precinct)
    : phase ? locationEvidenceForPhase(phase, precinct) : null
  return evidence && hasAnyFix(evidence) ? evidence : null
}

/** Whether `ExceptionMapButton` will render anything for this exception, so a caller
 *  deciding whether to show a shared footer/divider around it does not have to
 *  duplicate the evidence lookup above to find out. */
export function hasExceptionMapEvidence(exception: TripException, phase: PhaseDescriptor | undefined, precinct: Precinct | undefined): boolean {
  return evidenceFor(exception, phase, precinct) !== null
}

/**
 * "View on map" for a position-based exception, wherever its card is shown. A dispatcher
 * asking "how far off was it?" should get the picture from the first place they look,
 * not have to find the phase card's supporting evidence first.
 */
export function ExceptionMapButton({ exception, phase, precinct }: Props) {
  const [open, setOpen] = useState(false)
  const evidence = evidenceFor(exception, phase, precinct)
  if (!evidence) return null
  const contextLabel = `${fmtExceptionType(exception.exception_type)}${phase ? ` · ${PHASE_NAMES[phase.phase_type]}` : ''}${precinct ? ` at ${precinct.name}` : ''}`
  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>{VIEW_ON_MAP_LABEL}</Button>
    <LocationComparisonModal open={open} onClose={() => setOpen(false)} evidence={evidence} contextLabel={contextLabel} />
  </>
}
