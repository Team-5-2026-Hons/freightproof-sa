// frontend/driver-pwa/components/phase/steps/unloading/SealVerify.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { isValidSealFormat } from '@/lib/utils/seal-format'
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

// States the ordering constraint explicitly ("before it is broken"), because the photo is
// worthless as tamper evidence if taken after the warehouse opens the trailer — and the
// driver is standing next to warehouse staff who are waiting to do exactly that.
const INTACT_PHOTO_INSTRUCTION =
  'Photograph the seal now, while it is still intact and before the warehouse breaks it. This proves the trailer was not opened in transit.'

// BLIND entry, the same principle as the visual count (F1) applied to the seal.
//
// This screen used to show a "Seal set at departure" reference card, then a live
// match / mismatch / indeterminate indicator, and swapped the swipe to a red "Swipe to
// flag". All of it is gone (2026-08-05), along with the referenceSealNumber prop and the
// lib/hooks/useSealReference carry-forward that fed it.
//
// A driver shown the expected number before typing has not independently verified
// anything — they have copied. And telling them their entry mismatched invites a
// "correction" to whatever the screen says, destroying the one observation this step
// exists to record.
//
// The mismatch is still caught, and caught better: advance_unloading (backend/app/
// orchestration/phase_service.py) compares seal_number_at_destination against THIS LEG's
// own departure event server-side and writes a CRITICAL seal_mismatch TripException with
// source=SYSTEM. That comparison never depended on this client. What changed here is only
// that the driver is no longer told the answer in advance, or told the verdict after —
// the dispatcher sees it, silently, which is what the exception is for.
export function SealVerify({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealVerifyProps) {
  const { uploadNow } = useArtifactUpload(tripId)
  const [input, setInput] = useState(draft.sealNumberAtDestination ?? '')
  const hasInput = input.trim().length > 0
  // The backend 422s any destination seal not matching XX-#### before its own mismatch
  // comparison even runs, so a format error must still be caught here — it is the one
  // thing the driver can act on, and the only reason this screen blocks at all.
  const formatValid = isValidSealFormat(input)
  const showFormatHint = hasInput && !formatValid
  // UnloadingCompleteRequest.gate_photo_artifact_id is a required UUID, so an unloading
  // without this photo 422s at submit — by which point the seal is broken and the
  // photograph can never be taken. Blocking here is the only place the driver can still
  // act on it.
  const hasIntactPhoto = draft.sealIntactPhotoDataUrl !== null

  // Upload starts at capture, not at submit — same pattern as departure/CaptureSeal.tsx.
  // capturedAt is set here because this is the first evidence unloading captures; the
  // artifact id is cleared alongside the new data URL so a re-shot photo can never submit
  // under the previous shot's id.
  function handleIntactSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealIntactPhotoDataUrl: dataUrl, sealIntactPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealIntactPhotoArtifactId: artifactId })
    })
  }

  function handleInputChange(value: string) {
    // Seals are printed uppercase and the backend's format check accepts only uppercase
    // letters, so normalise on the way in rather than rejecting the driver's shift key.
    const upper = value.toUpperCase()
    setInput(upper)
    onUpdate({ sealNumberAtDestination: upper })
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
        {/* Always "Swipe to submit", never "Swipe to flag": the label itself would leak
            the comparison result this step is deliberately blind to. */}
        <SwipeToConfirm
          label="Swipe to submit"
          onConfirm={onComplete}
          disabled={!formatValid || !hasIntactPhoto}
        />
      </div>
    </main>
  )
}
