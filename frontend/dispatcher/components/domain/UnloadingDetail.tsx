'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { departureSealForLeg } from '@/lib/phase/derive'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

import type { TripException } from '@shared/lib/types/exception'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  sealException?: Pick<TripException, 'exception_type' | 'severity'>
  phase: PhaseDescriptor
  // Needed to find THIS leg's own departure — see departureSealForLeg. A cross-dock
  // trip has one departure per leg, so a plain "the trip's departure" lookup would
  // compare a later leg's arrival against an earlier leg's seal.
  allPhases: readonly PhaseDescriptor[]
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  /** Live, summed scanned_in_count over the consignments delivered at THIS stop —
   *  recomputed per request straight from Parcel rows. There is no stamped equivalent
   *  on this phase to fall back to once unloading closes: parcel_count_destination is
   *  written on the CONFIRMATION row instead (see ConfirmationDetail's own comment on
   *  that field), so this stays live for as long as this row is on screen. Null when
   *  nothing on the manifest is booked to arrive here — distinct from a real 0 scanned
   *  so far. */
  scannedInCount: number | null
  /** Manifest baseline for this stop — summed parcel_count_expected over the same
   *  consignments. Same null-is-not-zero rule as scannedInCount. */
  expectedAtStopCount: number | null
}

export function UnloadingDetail({ artifactLoading, artifactError, onRetryArtifacts,
  phase, allPhases, artifactsById, scannedInCount, expectedAtStopCount, sealException,
}: Props) {
  const departureSeal = departureSealForLeg(allPhases, phase)

  // Whether unloading itself has been decided — NOT whether the scan count could still
  // change (it always could, since it is recomputed live and nothing stamps it here).
  // This only controls the "scan in progress" note below.
  const resolved = isClosedPhaseStatus(phase.status)

  // Null is not zero: no baseline means nothing to compare, not "nothing was delivered".
  const hasBoth = expectedAtStopCount !== null && scannedInCount !== null
  const missing = hasBoth ? expectedAtStopCount - scannedInCount : 0

  // An exceptional phase alone does not identify which seal finding was recorded.
  const verdict = sealException?.exception_type === 'seal_mismatch'
    ? 'mismatch'
    : sealException?.exception_type === 'seal_unverified' || !departureSeal || !phase.seal_number
      ? 'unverified'
      : phase.status === 'completed' && departureSeal === phase.seal_number
        ? 'match'
        : 'unverified'

  return (
    <PhaseDetailCard>

      {/* Live progress, not the evidence record — parcel_count_destination (the stamped
          figure) is written on the CONFIRMATION row instead, once that later phase
          closes (see ConfirmationDetail's own comment on that field). Nothing on THIS
          row is ever stamped, so this section reads straight off Parcel rows for as
          long as it is on screen and is labelled as live rather than as a record. */}
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
          Scan in progress — this count may still change.
        </p>
      )}

      {/* No location section here — unlike activation, neither this phase's request
          schema nor the backend's advance_unloading captures driver_phone_lat/lng or
          horse_gps_lat/lng. Showing it would just be four permanently-blank rows. */}
      <Section title="Seal">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal at destination</div>
          {phase.seal_number ? (
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
              {phase.seal_number}
            </span>
          ) : (
            <span className="text-[12px] text-on-surf-v">Not captured</span>
          )}
        </div>
        <Field label="Seal at departure (this leg)" value={departureSeal} mono />
        {verdict !== null && (
          <div className={`col-span-2 text-[12px] font-[600] ${verdict === 'match' ? 'text-ok' : sealException?.severity === 'critical' ? 'text-err' : 'text-warn'}`}>
            {verdict === 'match'
              ? 'Recorded seals match ✓'
              : verdict === 'mismatch'
                ? `Mismatch — recorded as a ${sealException?.severity ?? 'recorded'} exception ✗`
                : 'Seal continuity unverified'}
          </div>
        )}
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="Seal photo at destination"
          artifactId={phase.gate_photo_artifact_id}
          artifact={phase.gate_photo_artifact_id ? artifactsById.get(phase.gate_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
