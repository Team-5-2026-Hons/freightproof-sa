// frontend/driver-pwa/components/phase/steps/confirmation/Reconciliation.tsx
'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

// Renders a green check / red cross for a boolean reconciliation row.
function StatusMark({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} aria-label="Done" />
  ) : (
    <XCircle className="h-5 w-5 text-error" strokeWidth={2} aria-label="Missing" />
  )
}

interface ReconciliationProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function Reconciliation({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: ReconciliationProps) {
  // See loading/VisualCount.tsx — onComplete's result is forwarded, never dropped, so
  // SwipeToConfirm can tell an in-flight submit from a finished one.
  function handleConfirm(): void | Promise<void> {
    onUpdate({ reconciliationNote: 'Driver confirmed delivery reconciliation at destination.' })
    return onComplete()
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Confirm that the unloading is reconciled with the warehouse. Any discrepancies have been logged."
      action={<SwipeToConfirm label="Confirm Reconciliation" onConfirm={handleConfirm} />}
    >
        {/* Old H5Reconciliation read sealBrokenPhotoDataUrl/waybillHandedOver here too — those
            were part of the SAME draft under the old fixed-5 model, where one H5Evidence
            object spanned everything from hand-waybill through reconciliation. Under the
            phase model, `unloading` and `confirmation` are separate phase_event_id rows
            with separate drafts (usePhaseDraft is keyed per phase_event_id, precisely so a
            repeated phase_type never collides) — ConfirmationEvidence genuinely has no
            sealBrokenPhotoDataUrl/waybillHandedOver fields to read, because that evidence
            belongs to a different, already-resolved phase. This summary is limited to what
            THIS phase's own draft actually carries: the visual count carried forward from
            unloading (see evidence-draft.ts's header comment) and this phase's own POD
            capture, both real fields on ConfirmationEvidence. */}
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-level-2">
          <div className="flex justify-between">
            <span className="text-body text-surface-on-variant">Parcels counted at destination</span>
            <span className="text-body font-semibold tabular-nums">{draft.driverVisualCount ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body text-surface-on-variant">Proof of delivery photo</span>
            <StatusMark ok={draft.podPhotoDataUrl !== null} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body text-surface-on-variant">Receiver confirmation</span>
            <StatusMark ok={Boolean(draft.podSignatureArtifactId)} />
          </div>
        </div>
    </StepLayout>
  )
}
