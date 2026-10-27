'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function DepartureDetail({ artifactLoading, artifactError, onRetryArtifacts, phase, precinct, artifactsById }: Props) {
  return (
    <PhaseDetailCard>

      <Section title="Seal">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal number</div>
          {phase.seal_number ? (
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
              {phase.seal_number}
            </span>
          ) : (
            <span className="text-[12px] text-on-surf-v">Not captured</span>
          )}
        </div>
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="Seal photo"
          artifactId={phase.seal_photo_artifact_id}
          artifact={phase.seal_photo_artifact_id ? artifactsById.get(phase.seal_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at departure" />

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
