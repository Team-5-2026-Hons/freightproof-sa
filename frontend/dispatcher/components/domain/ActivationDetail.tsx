'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  phase: PhaseDescriptor
  trip: Trip
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function ActivationDetail({ phase, trip, precinct }: Props) {
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

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
