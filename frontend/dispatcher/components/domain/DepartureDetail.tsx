'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseAnchorSection } from './PhaseAnchorSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  precinct: Precinct | undefined
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

export function DepartureDetail({ phase, precinct, artifactsById }: Props) {
  return (
    <PhaseDetailCard>

      {/* Each departure carries its OWN seal, so a cross-dock trip visibly shows a
          different seal per leg. Never hoist this to the trip. */}
      <Section title="Seal">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal number</div>
          {phase.seal_number ? (
            // Reuses the sidebar's seal badge exactly, translated off the legacy `bg-primary`/
            // `text-white`/`var(--r-sm)` tokens onto their shorthand equivalents (same hex,
            // real radius scale) — see DepartureDetail report for the mapping.
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
              {phase.seal_number}
            </span>
          ) : (
            <span className="text-[12px] text-on-surf-v">Not captured</span>
          )}
        </div>
        <EvidencePhoto
          label="Seal photo"
          artifact={phase.seal_photo_artifact_id ? artifactsById.get(phase.seal_photo_artifact_id) : undefined}
        />
        <EvidencePhoto
          label="Waybill photo"
          artifact={phase.waybill_photo_artifact_id ? artifactsById.get(phase.waybill_photo_artifact_id) : undefined}
        />
      </Section>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at departure" />

      <PhaseOverrideSection phase={phase} />

      <PhaseAnchorSection phase={phase} />

    </PhaseDetailCard>
  )
}
