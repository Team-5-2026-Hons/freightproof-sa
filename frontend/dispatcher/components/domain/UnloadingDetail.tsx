'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { departureSealForLeg } from '@/lib/phase/derive'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
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

export function UnloadingDetail({
  phase, allPhases, artifactsById, scannedInCount, expectedAtStopCount,
}: Props) {
  const departureSeal = departureSealForLeg(allPhases, phase)

  // Whether unloading itself has been decided — NOT whether the scan count could still
  // change (it always could, since it is recomputed live and nothing stamps it here).
  // This only controls the "scan in progress" note below.
  const resolved = isClosedPhaseStatus(phase.status)

  // Null is not zero: no baseline means nothing to compare, not "nothing was delivered".
  const hasBoth = expectedAtStopCount !== null && scannedInCount !== null
  const missing = hasBoth ? expectedAtStopCount - scannedInCount : 0

  // Read, never re-derived. advance_unloading sets this row to EXCEPTION on exactly
  // one condition — the destination seal not matching this leg's departure seal — so
  // the phase status IS the recorded verdict. Recomputing it here from the two seal
  // strings would let the dispatcher show "integrity confirmed" next to an exception
  // the backend actually raised, which on an evidence platform is the one thing this
  // panel must never do. The seals stay on screen so the verdict can be checked by eye.
  const verdict = phase.status === 'exception'
    ? 'mismatch'
    : phase.status === 'completed'
      ? 'match'
      : null

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
          {missing === 0 ? 'All parcels scanned ✓' : `${missing} not scanned ✗`}
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
          <div className={`col-span-2 text-[12px] font-[600] ${verdict === 'match' ? 'text-ok' : 'text-err'}`}>
            {verdict === 'match'
              ? 'Seal matches — integrity confirmed ✓'
              : 'Mismatch — recorded as a critical exception ✗'}
          </div>
        )}
        <EvidencePhoto
          label="Seal photo at destination"
          artifact={phase.gate_photo_artifact_id ? artifactsById.get(phase.gate_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
