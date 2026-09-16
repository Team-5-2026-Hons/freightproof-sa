'use client'

import { GRAINS } from '@/lib/format/period'
import type { Grain } from '@shared/lib/types/fleet-analytics'
import { FLEET_COPY } from '../copy'
import { RadioToggle } from './RadioToggle'

const COPY = FLEET_COPY.controls

interface GrainToggleProps {
  value: Grain
  onChange: (grain: Grain) => void
  /** Grains that would draw too many bars for the period: shown, but not selectable. */
  disabled: readonly Grain[]
}

/** View by Week / Month / Year. A grain with too many bars for the period stays visible,
 *  with a tooltip saying why it can't be chosen. */
export function GrainToggle({ value, onChange, disabled }: GrainToggleProps) {
  const options = GRAINS.map((grain) => ({
    value: grain,
    label: COPY.grainLabels[grain],
    disabled: disabled.includes(grain),
    disabledReason: COPY.tooManyBuckets[grain],
  }))
  return <RadioToggle label={COPY.viewBy} value={value} options={options} onChange={onChange} />
}
