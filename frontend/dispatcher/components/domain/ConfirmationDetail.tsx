'use client'

import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseAnchorSection } from './PhaseAnchorSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import { ReconciliationRows } from './ReconciliationRows'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function ConfirmationDetail({ phase, precinct, artifactsById }: Props) {
  return (
    <PhaseDetailCard>

      <Section title="Proof of delivery">
        <EvidencePhoto
          label="POD photo"
          artifact={phase.pod_photo_artifact_id ? artifactsById.get(phase.pod_photo_artifact_id) : undefined}
        />
        <EvidenceDocument
          label="POD signature"
          artifact={phase.pod_signature_artifact_id ? artifactsById.get(phase.pod_signature_artifact_id) : undefined}
        />
      </Section>

      {/* Same component the unloading panel uses, so the two verdicts cannot disagree. */}
      <div className="py-3">
        <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[6px]">
          Reconciliation
        </div>
        <ReconciliationRows
          countedAtDestination={phase.parcel_count_destination}
          driverVisualCount={phase.driver_visual_count}
        />
      </div>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at confirmation" />

      <PhaseAnchorSection phase={phase} />

    </PhaseDetailCard>
  )
}
