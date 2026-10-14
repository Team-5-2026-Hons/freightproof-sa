'use client'

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
  /** Manifest baseline from Parcel Perfect's tracks[]. Null when the trip has no PP reference. */
  expectedCount: number | null
  /** Live, summed scanned_out_count for this stop; read only while loading is open —
   *  once resolved, phase.parcel_count_origin (the stamped tally) takes over. */
  liveScannedOutCount: number | null
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  precinct: Precinct | undefined
}

// Loading is system-observed: the warehouse's scan records what went on the truck.
export function LoadingDetail({ artifactLoading, artifactError, onRetryArtifacts, phase, expectedCount, liveScannedOutCount, artifactsById, precinct }: Props) {
  // parcel_count_origin is written once at phase close (the evidence); scanned_out_count
  // is recomputed every request until then — swapping one in for the other is not allowed.
  const resolved = isClosedPhaseStatus(phase.status)
  const scanned = resolved ? phase.parcel_count_origin : liveScannedOutCount
  const scannedLabel = resolved ? 'Scanned onto truck' : 'Scanned onto truck (in progress)'

  // Null is not zero: no baseline means nothing to compare, not "nothing was loaded".
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
      {/* linehaul_photo_artifact_id, not waybill_photo_artifact_id — that one is only set
          on the departure phase's row. No wrapping Section: EvidencePhoto already
          renders its own label, matching Departure/Confirmation's pattern. */}
      <div className="py-3 first:pt-0 last:pb-0">
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="Linehaul document"
          artifactId={phase.linehaul_photo_artifact_id}
          artifact={phase.linehaul_photo_artifact_id ? artifactsById.get(phase.linehaul_photo_artifact_id) : undefined}
        />
      </div>
      {/* Guards against an empty "Location at loading" heading when nothing was recorded. */}
      {hasLocationEvidence(locationEvidenceForPhase(phase, precinct)) && (
        <PhaseLocationSection phase={phase} precinct={precinct} title="Location at loading" />
      )}
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
