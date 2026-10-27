'use client'

import { countLabel } from '@/lib/format/count'
import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  phase: PhaseDescriptor
  originScannedCount: number | null
  precinct?: Precinct | undefined
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
}

export function ConfirmationDetail({ artifactLoading, artifactError, onRetryArtifacts,
  phase, originScannedCount, precinct, artifactsById = new Map(),
}: Props) {
  const destination = phase.parcel_count_destination
  const hasBoth = originScannedCount !== null && destination !== null
  const unaccounted = hasBoth ? originScannedCount - destination : 0

  return (
    <PhaseDetailCard>

      <Section title="Proof of delivery">
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="POD photo"
          artifactId={phase.pod_photo_artifact_id}
          artifact={phase.pod_photo_artifact_id ? artifactsById.get(phase.pod_photo_artifact_id) : undefined}
        />
        <EvidenceDocument
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="POD signature (Ed25519)"
          artifactId={phase.pod_signature_artifact_id}
          artifact={phase.pod_signature_artifact_id ? artifactsById.get(phase.pod_signature_artifact_id) : undefined}
        />
      </Section>

      <Section title="Chain of custody">
        <Field label="Scanned out (origin depot)" value={originScannedCount?.toString()} />
        <Field label="Scanned in (destination depot)" value={destination?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${unaccounted === 0 ? 'text-ok' : 'text-warn'}`}>
          {unaccounted === 0
            ? 'Counts agree ✓'
            : unaccounted < 0 ? `${Math.abs(unaccounted)} excess parcels scanned at destination` : `${countLabel(unaccounted, 'parcel')} unaccounted for in transit ✗`}
        </div>
      )}

      <Section title="Driver observation">
        <Field label="Parcels counted by driver" value={phase.driver_visual_count?.toString()} />
      </Section>
      <div className="text-[11px] text-on-surf-v px-3 pb-3">
        Counted blind: recorded as independent evidence, not reconciled against the scans above.
      </div>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at confirmation" />

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
