'use client'

import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { locationEvidenceForPhase, hasLocationEvidence } from '@/lib/phase/location-evidence'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  phase: PhaseDescriptor
  expectedCount: number | null
  liveScannedOutCount: number | null
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  precinct: Precinct | undefined
}

export function LoadingDetail({ artifactLoading, artifactError, onRetryArtifacts, phase, expectedCount, liveScannedOutCount, artifactsById, precinct }: Props) {
  const resolved = isClosedPhaseStatus(phase.status)
  const scanned = resolved ? phase.parcel_count_origin : liveScannedOutCount
  const scannedLabel = resolved ? 'Scanned onto truck' : 'Scanned onto truck (in progress)'

  const hasBoth = expectedCount !== null && scanned !== null
  const missing = hasBoth ? expectedCount - scanned : 0

  return (
    <PhaseDetailCard>
      <Section title="Warehouse scan">
        <Field label="Expected (manifest)" value={expectedCount?.toString()} />
        <Field label={scannedLabel} value={scanned?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${missing === 0 ? 'text-ok' : 'text-warn'}`}>
          {missing === 0 ? 'All parcels scanned ✓' : missing < 0 ? `${Math.abs(missing)} excess scanned` : `${missing} not scanned ✗`}
        </div>
      )}
      <div className="py-3 first:pt-0 last:pb-0">
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="Linehaul document"
          artifactId={phase.linehaul_photo_artifact_id}
          artifact={phase.linehaul_photo_artifact_id ? artifactsById.get(phase.linehaul_photo_artifact_id) : undefined}
        />
      </div>
      {phase.linehaul_pdf_artifact_id && (
        <div className="py-3 first:pt-0 last:pb-0">
          <EvidenceDocument
            loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
            label="Linehaul sheet (PDF)"
            artifactId={phase.linehaul_pdf_artifact_id}
            artifact={artifactsById.get(phase.linehaul_pdf_artifact_id)}
          />
        </div>
      )}
      {hasLocationEvidence(locationEvidenceForPhase(phase, precinct)) && (
        <PhaseLocationSection phase={phase} precinct={precinct} title="Location at loading" />
      )}
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
