'use client'

import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import { hasAnyFix, hasLocationEvidence, locationEvidenceForPhase } from '@/lib/phase/location-evidence'
import { Field, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'

interface Props {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  slotTime: string | null
}

const SUMMARY = 'flex min-h-11 cursor-pointer items-center gap-1 text-meta font-semibold text-sec underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'

/** Whether there is anything to put behind the disclosure. An activation always has its
 *  expected location; every other phase needs a recorded fix or a stored verdict, so a card
 *  never grows an empty "Location details". */
export function hasLocationDetails(phase: PhaseDescriptor, precinct: Precinct | undefined): boolean {
  if (phase.phase_type === 'activation') return true
  if (phase.phase_type === 'in_transit') return hasAnyFix(locationEvidenceForPhase(phase, undefined))
  return hasLocationEvidence(locationEvidenceForPhase(phase, precinct))
}

/** An activation's expected location: where the truck was due and when. */
function ExpectedLocation({ precinct, slotTime }: { precinct: Precinct | undefined; slotTime: string | null }) {
  return (
    <Section title="Expected location">
      <Field label="Precinct" value={precinct?.name} span />
      <Field label="Address" value={precinct?.address} span />
      <Field label="Slot time" value={slotTime === null ? null : fmtDateTime(slotTime)} />
    </Section>
  )
}

/**
 * The raw location evidence behind a check: the driver's and tracker's fixes, their capture
 * times, the separation, the boundary and the map. Detail, not verdict: the verdict is one
 * line in Checked, and this stays a disclosure so the supporting fields do not crowd the card (F6).
 * An in_transit leg shows its recorded arrival fix here, with no boundary: its stop is the
 * one it departed from, so a fence would be the wrong one.
 */
export function PhaseLocationDetails({ phase, precinct, slotTime }: Props) {
  if (!hasLocationDetails(phase, precinct)) return null
  const isTransit = phase.phase_type === 'in_transit'
  const showRecorded = !isTransit && hasLocationEvidence(locationEvidenceForPhase(phase, precinct))
  return (
    <details className="group/details mt-1">
      <summary className={SUMMARY}>
        <Ic n="chev" s={12} className="transition-transform group-open/details:rotate-90 motion-reduce:transition-none" />
        Location details
      </summary>
      <div className="mt-2 divide-y divide-outline-v/15">
        {phase.phase_type === 'activation' && <ExpectedLocation precinct={precinct} slotTime={slotTime} />}
        {isTransit && <PhaseLocationSection phase={phase} precinct={undefined} title="Recorded location at arrival" showCoordinates={false} />}
        {showRecorded && <PhaseLocationSection phase={phase} precinct={precinct} title="Recorded location" showCoordinates={false} />}
      </div>
    </details>
  )
}
