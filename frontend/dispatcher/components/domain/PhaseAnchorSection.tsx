import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { CopyField, Field, Section } from './PhaseDetailFields'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

/**
 * Anchor state for the phases that carry a Hedera receipt. Departure and confirmation
 * are fail-open, so `completed` and `failed` can be true at once — never render as an
 * unqualified success.
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
      {/* The phase's own SHA-256, anchored value a reviewer recomputes against the chain. */}
      <ForensicOnly>
        <CopyField label="Event hash (SHA-256)" value={phase.event_hash} mono span />
      </ForensicOnly>
    </Section>
  )
}
