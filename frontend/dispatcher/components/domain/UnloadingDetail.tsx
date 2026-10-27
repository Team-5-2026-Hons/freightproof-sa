'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { locationEvidenceForPhase, hasLocationEvidence } from '@/lib/phase/location-evidence'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  scannedInCount: number | null
  expectedAtStopCount: number | null
  precinct: Precinct | undefined
}

export function UnloadingDetail({
  phase, scannedInCount, expectedAtStopCount, precinct,
}: Props) {
  const resolved = isClosedPhaseStatus(phase.status)

  const hasBoth = expectedAtStopCount !== null && scannedInCount !== null
  const missing = hasBoth ? expectedAtStopCount - scannedInCount : 0

  return (
    <PhaseDetailCard>

      <Section title="Warehouse scan">
        <Field label="Scanned off truck (live)" value={scannedInCount?.toString()} />
        <Field label="Expected at this stop" value={expectedAtStopCount?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${missing === 0 ? 'text-ok' : 'text-warn'}`}>
          {missing === 0 ? 'All parcels scanned ✓' : missing < 0 ? `${Math.abs(missing)} excess scanned` : `${missing} not scanned ✗`}
        </div>
      )}
      {!resolved && (
        <p className="text-[10px] text-on-surf-v px-3 pb-3">
          Scan in progress. This count may still change.
        </p>
      )}

      {hasLocationEvidence(locationEvidenceForPhase(phase, precinct)) && (
        <PhaseLocationSection phase={phase} precinct={precinct} title="Location at unloading" />
      )}

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
