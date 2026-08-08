'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { isClosedPhaseStatus } from '@/lib/types/dev'
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
}

// Loading is now system-observed: the warehouse's scan is what records what went on the
// truck, and parcel_count_origin is the scanned tally stamped at close. The driver's own
// count is gone — he never enters the warehouse and could not honestly produce one.
export function LoadingDetail({ phase, expectedCount, liveScannedOutCount }: Props) {
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
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
