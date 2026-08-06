'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  /** Manifest baseline from Parcel Perfect's tracks[]. Null when the trip carries no
   *  PP reference — common, and not a failure. */
  expectedCount: number | null
}

// Loading is now system-observed: the warehouse's scan is what records what went on the
// truck, and parcel_count_origin is the scanned tally stamped at close. The driver's own
// count is gone — he never enters the warehouse and could not honestly produce one.
export function LoadingDetail({ phase, expectedCount }: Props) {
  const scanned = phase.parcel_count_origin
  // Null is not zero: no baseline means nothing to compare, not "nothing was loaded".
  const hasBoth = expectedCount !== null && scanned !== null
  const missing = hasBoth ? expectedCount - scanned : 0

  return (
    <PhaseDetailCard>
      <Section title="Warehouse scan">
        <Field label="Expected (manifest)" value={expectedCount?.toString()} />
        <Field label="Scanned onto truck" value={scanned?.toString()} />
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
