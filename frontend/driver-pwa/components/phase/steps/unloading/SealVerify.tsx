'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { isValidSealFormat, normalizeSeal } from '@/lib/utils/seal-format'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface SealVerifyProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// The photo is worthless as tamper evidence if taken after the warehouse opens the trailer.
const INTACT_PHOTO_INSTRUCTION =
  'Photograph the seal now, while it is still intact and before the warehouse breaks it. This proves the trailer was not opened in transit.'

// Blind entry, same principle as the visual count: showing the driver the expected seal
// number before they type invites copying, not verification. advance_unloading compares
// seal_number_at_destination against this leg's own departure event server-side and
// writes a CRITICAL seal_mismatch exception; the driver is never told the verdict.
export function SealVerify({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealVerifyProps) {
  const { uploadNow } = useArtifactUpload(tripId)
  const [input, setInput] = useState(draft.sealNumberAtDestination ?? '')
  const hasInput = input.trim().length > 0
  // The backend 422s any destination seal not matching XX-#### before its own mismatch
  // comparison runs, so format must still be caught here.
  const formatValid = isValidSealFormat(input)
  const showFormatHint = hasInput && !formatValid
  // gate_photo_artifact_id is a required UUID at submit, by which point the seal is
  // broken and the photo can never be taken — blocking here is the only place to act on it.
  const hasIntactPhoto = draft.sealIntactPhotoDataUrl !== null

  // Upload starts at capture, not submit. Artifact id is cleared alongside the new data
  // URL so a re-shot photo can never submit under the previous shot's id.
  function handleIntactSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealIntactPhotoDataUrl: dataUrl, sealIntactPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealIntactPhotoArtifactId: artifactId })
    })
  }

  function handleInputChange(value: string) {
    // Stores the exact value isValidSealFormat checks, so a stray leading/trailing space
    // can never pass this screen's gate while still being what gets submitted.
    const normalized = normalizeSeal(value)
    setInput(normalized)
    onUpdate({ sealNumberAtDestination: normalized })
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <Input
          label="Enter seal number from vehicle"
          placeholder="Type the seal number you see"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        {showFormatHint && (
          <p className="text-base text-error">
            Seal number must look like AB-1234 (two letters, four digits).
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-outline-variant pt-6">
          <p className="text-lg leading-relaxed text-surface-on-variant">
            {INTACT_PHOTO_INSTRUCTION}
          </p>
          <CameraCapture
            label="Intact seal photo"
            dataUrl={draft.sealIntactPhotoDataUrl}
            onCapture={handleIntactSealPhoto}
          />
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        {/* Always "Swipe to submit": the label must never leak the comparison result. */}
        <SwipeToConfirm
          label="Swipe to submit"
          onConfirm={onComplete}
          disabled={!formatValid || !hasIntactPhoto}
        />
      </div>
    </main>
  )
}
