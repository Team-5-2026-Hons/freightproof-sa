// frontend/driver-pwa/components/phase/steps/unloading/SealBreakInspection.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface SealBreakInspectionProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function SealBreakInspection({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealBreakInspectionProps) {
  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Wait for the warehouse to inspect and break the seal. Photograph the broken seal as evidence.
        </p>
        <CameraCapture
          label="Broken seal photo"
          dataUrl={draft.sealBrokenPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ sealBrokenPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!draft.sealBrokenPhotoDataUrl} />
      </div>
    </main>
  )
}
