'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
}

// Deliberately thin: loading only ever captures the driver's own visual parcel
// count (D7/T5 — the seal moved to departure). No location section either — the
// request schema carries no driver_phone_lat/lng, so there is nothing to show.
export function LoadingDetail({ phase }: Props) {
  const expected = phase.parcel_count_origin
  const counted = phase.driver_visual_count
  // Both nullable, and null is not zero — a trip with no manifest baseline yet has
  // nothing to compare, only a count to display (mirrors the backend's own
  // no-baseline-means-skip rule in advance_loading).
  const hasBoth = expected !== null && counted !== null

  return (
    <PhaseDetailCard>
      <Section title="Count">
        <Field label="Expected (manifest)" value={expected?.toString()} />
        <Field label="Driver visual count" value={counted?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${expected === counted ? 'text-ok' : 'text-warn'}`}>
          {expected === counted
            ? 'Counts agree ✓'
            : `Discrepancy of ${Math.abs(expected - counted)} ✗`}
        </div>
      )}
    </PhaseDetailCard>
  )
}
