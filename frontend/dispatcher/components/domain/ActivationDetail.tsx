'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'

interface Props {
  phase: PhaseDescriptor
  trip: Trip
  // The precinct this phase is anchored to, resolved by the page from phase.stop_sequence.
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

const IDVS_LABELS: Record<Trip['idvs_check_status'], string> = {
  pending:  'Pending',
  verified: 'Verified ✓',
  failed:   'Failed ✗',
}

export function ActivationDetail({ phase, trip, precinct, artifactsById }: Props) {
  const stop = phase.stop_sequence === null
    ? undefined
    : trip.stops.find(s => s.sequence === phase.stop_sequence)

  return (
    <PhaseDetailCard>

      <Section title="Expected location">
        <Field label="Precinct"  value={precinct?.name} span />
        <Field label="Address"   value={precinct?.address} span />
        <Field label="Slot time" value={fmtDateTime(stop?.slot_time)} />
        <Field label="Arrived"   value={phase.completed_at ? fmtDateTime(phase.completed_at) : 'Not yet'} />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} />

      <Section title="Verification">
        <Field label="Identity check" value={IDVS_LABELS[trip.idvs_check_status]} />
        <Field label="Anchor"         value={phase.anchor_status} />
        <EvidencePhoto
          label="Gate photo"
          artifact={phase.gate_photo_artifact_id ? artifactsById.get(phase.gate_photo_artifact_id) : undefined}
        />
      </Section>

      {/* An override means a human bypassed a check. It is never a footnote. */}
      {phase.dispatcher_override_note && (
        <Section title="Dispatcher override">
          <Field label="Note" value={phase.dispatcher_override_note} span />
        </Section>
      )}

    </PhaseDetailCard>
  )
}
