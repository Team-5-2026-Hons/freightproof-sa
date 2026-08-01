import { Field, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

/**
 * Anchor state for the phases that carry a Hedera receipt.
 *
 * Departure and confirmation are both fail-open: the phase completes even when anchoring
 * fails, so `completed` and `failed` can be true at once. That pairing is what makes the
 * policy honest and it must never render as an unqualified success.
 */
export function PhaseAnchorSection({ phase }: { phase: PhaseDescriptor }) {
  return (
    <Section title="Anchor">
      <Field label="Status" value={phase.anchor_status} />
      {phase.anchor_status === 'failed' && (
        <div className="col-span-2 text-[11px] font-[600] text-warn">
          ⚠ Anchor failed — receipt still owed
        </div>
      )}
    </Section>
  )
}
