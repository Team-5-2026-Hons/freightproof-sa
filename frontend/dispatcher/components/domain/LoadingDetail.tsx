'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  /** Manifest baseline from Parcel Perfect's tracks[]. Null when the trip carries no
   *  PP reference — common, and not a failure. */
  expectedCount: number | null
  /** Live, summed scanned_out_count over the consignments picked up at THIS stop —
   *  recomputed per request from Parcel rows. Read only while loading is still open;
   *  once the phase resolves, phase.parcel_count_origin (the stamped tally) takes over
   *  and this is ignored even if still supplied. Null when nothing on the manifest is
   *  booked to collect here — distinct from a real 0 scanned so far. */
  liveScannedOutCount: number | null
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

// Loading is now system-observed: the warehouse's scan is what records what went on the
// truck, and parcel_count_origin is the scanned tally stamped at close. The driver's own
// count is gone — he never enters the warehouse and could not honestly produce one.
export function LoadingDetail({ phase, expectedCount, liveScannedOutCount, artifactsById }: Props) {
  // Governing distinction: parcel_count_origin is written ONCE at phase close and is the
  // evidence; scanned_out_count is recomputed every request and still moving until then.
  // Swapping a live figure in where the stamped one belongs (or vice versa) is the one
  // thing this panel must not do — hence the resolved/unresolved branch, not a fallback.
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
          {missing === 0 ? 'All parcels scanned ✓' : `${missing} not scanned ✗`}
        </div>
      )}
      {/* linehaul_photo_artifact_id, NOT waybill_photo_artifact_id: that field is only
          ever set on the departure phase's own row (advance_departure), so reading it
          here would silently and permanently read null. linehaul_photo_artifact_id is
          the one genuinely captured during THIS phase (advance_loading) — the
          warehouse's linehaul sheet, distinct from departure's waybill copy.
          No wrapping <Section title="Linehaul document"> here: EvidencePhoto already
          renders that string as its own label, and Section would duplicate it — every
          other card in this family (Departure's "Seal"/"Seal photo", Confirmation's
          "Proof of delivery"/"POD photo") keeps the section heading distinct from the
          photo label for the same reason. This div only mirrors Section's own spacing. */}
      <div className="py-3 first:pt-0 last:pb-0">
        <EvidencePhoto
          label="Linehaul document"
          artifact={phase.linehaul_photo_artifact_id ? artifactsById.get(phase.linehaul_photo_artifact_id) : undefined}
        />
      </div>
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
