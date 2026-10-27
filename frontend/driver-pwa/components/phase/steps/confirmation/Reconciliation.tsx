'use client'

import type { ReactNode } from 'react'
import { Camera, Check, Package, PenLine, X } from 'lucide-react'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { cn } from '@/lib/utils'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

function StatusMark({ ok, what }: { ok: boolean; what: string }) {
  return (
    <span
      role="img"
      aria-label={`${what}: ${ok ? 'recorded' : 'missing'}`}
      className={cn('flex size-7 items-center justify-center rounded-full', ok ? 'bg-success text-success-on' : 'bg-error text-error-on')}
    >
      {ok ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <X className="size-4" strokeWidth={3} aria-hidden />}
    </span>
  )
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[60px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-4 py-2">
      <span aria-hidden className="flex text-surface-on">{icon}</span>
      <span className="text-body text-surface-on">{label}</span>
      {children}
    </div>
  )
}

interface ReconciliationProps {
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function Reconciliation({ phase, stepIndex, draft, onUpdate, onComplete }: ReconciliationProps) {
  function handleConfirm(): void | Promise<void> {
    onUpdate({ reconciliationNote: 'Driver confirmed delivery reconciliation at destination.' })
    return onComplete()
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Confirm unloading matches the warehouse. Anything that didn’t is already logged."
      action={<SwipeToConfirm label="Swipe to Confirm All" onConfirm={handleConfirm} />}
    >
      <div className="divide-y divide-hairline">
        <Row icon={<Package className="size-6" strokeWidth={1.8} />} label="Parcels you counted">
          {draft.driverVisualCount !== null
            ? <span className="text-title-3 tabular-nums text-surface-on">{draft.driverVisualCount}</span>
            : <span className="text-body text-surface-on-variant">Not counted</span>}
        </Row>
        <Row icon={<Camera className="size-6" strokeWidth={1.8} />} label="Delivery photo">
          <StatusMark ok={draft.podPhotoDataUrl !== null} what="Delivery photo" />
        </Row>
        <Row icon={<PenLine className="size-6" strokeWidth={1.8} />} label="Receiver signature">
          <StatusMark ok={Boolean(draft.podSignatureArtifactId)} what="Receiver signature" />
        </Row>
      </div>
    </StepLayout>
  )
}
