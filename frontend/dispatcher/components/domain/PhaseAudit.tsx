'use client'

import { ChainReceiptTag } from '@/components/blockchain/ChainReceiptTag'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { VerifyButton } from '@/components/blockchain/VerifyButton'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { CopyField } from './PhaseDetailFields'
import { PhaseZone } from './PhaseZone'

interface Props {
  phase: PhaseDescriptor
  receipt: BlockchainReceipt | undefined
}

/**
 * The "Audit trail" zone: can this be proved? The receipt, the phase's own event hash (the
 * value a reviewer recomputes against the chain) and Verify. Forensic mode only (D32): with
 * it off the zone is not rendered at all, so a card has two zones and nothing about anchoring
 * appears on any phase. The caller mounts it for a resolved phase only: nothing is anchored
 * before a phase completes.
 */
export function PhaseAudit({ phase, receipt }: Props) {
  const verifiable = receipt?.subject_type === 'phase_event'
  const empty = !receipt && !phase.event_hash
  return (
    <ForensicOnly>
      <PhaseZone title="Audit trail">
        <div className="space-y-2">
          {receipt && <ChainReceiptTag receipt={receipt} />}
          {phase.event_hash && <CopyField label="Event hash (SHA-256)" value={phase.event_hash} mono />}
          {verifiable && (
            <VerifyButton
              subjectType="phase_event"
              subjectId={phase.phase_event_id}
              ariaLabel={`Verify integrity for ${PHASE_NAMES[phase.phase_type]} receipt, phase ${phase.sequence_number}`}
            />
          )}
          {empty && <p className="text-meta text-on-surf-v">Nothing anchored yet.</p>}
        </div>
      </PhaseZone>
    </ForensicOnly>
  )
}
