'use client'

import { useEffect, useRef } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { useSealOcr } from '@/lib/hooks/useSealOcr'
import { canReplaceWithOcr } from '@/lib/ocr/sealSource'
import { SealInput } from '@/components/phase/SealInput'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { isValidSealFormat } from '@/lib/utils/seal-format'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface CaptureSealProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onUpdate: (patch: Partial<DepartureEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function CaptureSeal({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: CaptureSealProps) {
  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)
  const sealNumber = draft.sealNumber ?? ''
  const sealFormatValid = isValidSealFormat(sealNumber)
  const showSealFormatHint = sealNumber.trim().length > 0 && !sealFormatValid

  const { reading, readSeal } = useSealOcr()
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'seal_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
    void readSeal(dataUrl).then((result) => {
      if (result.stale) return
      const current = draftRef.current
      onUpdate(canReplaceWithOcr(current.sealNumber, current.sealNumberOcr ?? null)
        ? { sealNumberOcr: result.value, sealNumber: result.value }
        : { sealNumberOcr: null })
    })
  }

  const readFromPhoto = sealNumber !== '' && sealNumber === (draft.sealNumberOcr ?? null)

  const isReady = sealFormatValid && draft.sealPhotoDataUrl !== null && !reading

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Photograph the seal, then check the number. The number is locked into the journey record."
      requirements={[
        { label: 'Seal photo', met: draft.sealPhotoDataUrl !== null },
        { label: 'Seal number', met: sealFormatValid },
      ]}
      action={
        <SwipeToConfirm
          label="Swipe to Save Seal"
          waitingLabel={reading ? 'Reading the seal…' : 'Add photo and number'}
          onConfirm={onComplete}
          disabled={!isReady}
        />
      }
    >
      <SealInput
        sealNumber={draft.sealNumber}
        sealPhotoDataUrl={draft.sealPhotoDataUrl}
        sealPhotoCapturedAt={draft.capturedAt}
        formatError={showSealFormatHint ? 'Seal number must look like AB-1234 (two letters, four digits).' : undefined}
        hint={readFromPhoto ? 'Read from the photo. Check it matches the seal.' : undefined}
        reading={reading}
        onSealNumberChange={(v) => onUpdate({ sealNumber: v })}
        onSealPhotoCapture={handleSealPhoto}
      />
    </StepLayout>
  )
}
