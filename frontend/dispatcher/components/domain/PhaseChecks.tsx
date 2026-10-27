'use client'

import { Ic, type IconName } from '@/components/ui/Ic'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import { checksAwaitingLabel } from '@/lib/phase/act-wording'
import type { CheckedZone } from '@/lib/phase/card'
import { CHECK_WORDING, type CheckResult, type PhaseCheck } from '@/lib/phase/checks'
import { NumericText } from './NumericText'
import { PhaseLocationDetails } from './PhaseLocationDetails'
import { PhaseZone } from './PhaseZone'

export interface PhaseChecksProps {
  phase: PhaseDescriptor
  checks: readonly PhaseCheck[]
  zone: CheckedZone
  precinct: Precinct | undefined
  slotTime: string | null
}

interface ResultStyle {
  icon: IconName
  text: string
  iconText: string
}

const RESULT_STYLE: Record<CheckResult, ResultStyle> = {
  pass: { icon: 'check', text: 'text-on-surf', iconText: 'text-ok' },
  flag: { icon: 'warn', text: 'text-warn', iconText: 'text-warn' },
  not_checked: { icon: 'eye', text: 'text-on-surf', iconText: 'text-on-surf-v' },
  in_progress: { icon: 'clock', text: 'text-on-surf', iconText: 'text-sec' },
}

const TRANSIT_ABSENCE = 'Only recorded journey events are shown. A tracker check appears here only when it raises an exception.'
const TRANSIT_NO_VERDICT = 'No location verdict is recorded for transit legs'

function CheckLine({ check }: { check: PhaseCheck }) {
  const style = RESULT_STYLE[check.result]
  return (
    <li data-check-result={check.result} className="flex gap-2.5">
      <span className={`mt-[2px] shrink-0 ${style.iconText}`}><Ic n={style.icon} s={15} /></span>
      <div className="min-w-0 pb-3">
        <p className={`text-body font-semibold ${style.text}`}><NumericText text={check.title} /></p>
        <p className="text-meta text-on-surf-v"><NumericText text={check.detail} /></p>
      </div>
    </li>
  )
}

function TransitNotes() {
  return (
    <>
      <p className="text-meta text-on-surf-v">{TRANSIT_ABSENCE}</p>
      <p className="mt-1 text-meta text-on-surf-v">{TRANSIT_NO_VERDICT}</p>
    </>
  )
}

/** The driver's blind count is evidence in its own right, kept out of the verdict so its
 *  independence is not spent; the note says why it is not reconciled. Shown only when the
 *  driver recorded one. */
function BlindCountNote({ phase }: { phase: PhaseDescriptor }) {
  if (phase.phase_type !== 'confirmation' || phase.driver_visual_count === null) return null
  return <p className="mt-2 text-meta text-on-surf-v">{CHECK_WORDING.counts.blindCountNote}</p>
}

/**
 * The "Checked" zone: was it right? One line per check (the truck against the precinct and the
 * driver against the truck are separate lines, D43), the raw fixes behind "Location details",
 * and, before the driver confirms, only a note saying when checks will appear (D34): an
 * unfinished phase never asserts a result. Renders nothing for a phase with no such zone.
 */
export function PhaseChecks({ phase, checks, zone, precinct, slotTime }: PhaseChecksProps) {
  if (zone === 'none') return null
  const isTransit = phase.phase_type === 'in_transit'
  return (
    <PhaseZone title="Checked">
      {checks.length > 0 && <ul>{checks.map(check => <CheckLine key={check.key} check={check} />)}</ul>}
      {zone === 'awaiting' && <p className="text-meta text-on-surf-v">{checksAwaitingLabel(phase.phase_type)}</p>}
      {isTransit && <TransitNotes />}
      <PhaseLocationDetails phase={phase} precinct={precinct} slotTime={slotTime} />
      <BlindCountNote phase={phase} />
    </PhaseZone>
  )
}
