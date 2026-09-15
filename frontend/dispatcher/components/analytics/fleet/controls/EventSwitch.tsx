'use client'

import { FLEET_COPY } from '../copy'
import { RadioToggle } from './RadioToggle'

export type PatternEvent = 'departures' | 'arrivals'

const OPTIONS = [
  { value: 'departures', label: FLEET_COPY.controls.events.departures },
  { value: 'arrivals', label: FLEET_COPY.controls.events.arrivals },
] as const satisfies readonly { value: PatternEvent; label: string }[]

interface EventSwitchProps {
  value: PatternEvent
  onChange: (event: PatternEvent) => void
}

/** Departures | Arrivals above the busy-pattern charts. Both come back in one response, so
 *  switching only changes which half is drawn: it never asks the server again (spec §5.1). */
export function EventSwitch({ value, onChange }: EventSwitchProps) {
  // No caption: it sits on a card's title row or beside a labelled control (spec §7.7 item 5).
  return <RadioToggle label={FLEET_COPY.controls.eventsLabel} showLabel={false} value={value} options={OPTIONS} onChange={onChange} />
}
