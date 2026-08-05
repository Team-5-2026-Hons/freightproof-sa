'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { departureSealForLeg } from '@/lib/phase/derive'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  // Needed to find THIS leg's own departure — see departureSealForLeg. A cross-dock
  // trip has one departure per leg, so a plain "the trip's departure" lookup would
  // compare a later leg's arrival against an earlier leg's seal.
  allPhases: readonly PhaseDescriptor[]
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function UnloadingDetail({ phase, allPhases, artifactsById }: Props) {
  const departureSeal = departureSealForLeg(allPhases, phase)

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
