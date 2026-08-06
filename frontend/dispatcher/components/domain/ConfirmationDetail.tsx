'use client'

import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseAnchorSection } from './PhaseAnchorSection'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  /** Parcels scanned onto the truck at this consignment's PICKUP stop — which on a
   *  cross-dock trip is not the stop immediately before this one. */
  originScannedCount: number | null
  // Both optional: the POD/location/anchor sections below are unaffected by the
  // reconciliation redesign this component exists for, but the trip detail page's
  // call site still has both to give, so they are defaulted rather than dropped.
  precinct?: Precinct | undefined
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
}

// The reconciliation is parcel-grain on both sides and sourced from two independent depot
// systems. The driver's pallet count is shown but deliberately excluded from the verdict:
// it is a different unit, and comparing it against a parcel count was the fault this
// redesign removed.
export function ConfirmationDetail({
  phase, originScannedCount, precinct, artifactsById = new Map(),
}: Props) {
  const destination = phase.parcel_count_destination
  const hasBoth = originScannedCount !== null && destination !== null
  const unaccounted = hasBoth ? originScannedCount - destination : 0

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

      <Section title="Chain of custody">
        <Field label="Scanned out (origin depot)" value={originScannedCount?.toString()} />
        <Field label="Scanned in (destination depot)" value={destination?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${unaccounted === 0 ? 'text-ok' : 'text-warn'}`}>
          {unaccounted === 0
            ? 'Counts agree ✓'
            : `${unaccounted} parcel unaccounted for in transit ✗`}
        </div>
      )}

      <Section title="Driver observation">
        <Field label="Pallets counted by driver" value={phase.driver_visual_count?.toString()} />
      </Section>
      <div className="text-[11px] text-on-surf-v px-3 pb-3">
        Pallet grain — recorded, not reconciled against the parcel counts above.
      </div>

      <PhaseLocationSection phase={phase} precinct={precinct} title="Location at confirmation" />

      <PhaseOverrideSection phase={phase} />

      <PhaseAnchorSection phase={phase} />

    </PhaseDetailCard>
  )
}
