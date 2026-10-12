'use client'

import { useState } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { isValidSealFormat, normalizeSeal } from '@/lib/utils/seal-format'
import { cn } from '@/lib/utils'
import type { PhaseDescriptor, SealCondition } from '@shared/lib/types/phase'
import type { ArrivalEvidence } from '@/lib/types/evidence-draft'

interface SealVerifyProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ArrivalEvidence
  onUpdate: (patch: Partial<ArrivalEvidence>) => void
  onComplete: () => void | Promise<void>
}

// The custody check this whole phase exists for: the seal as found at the gate, before
// anything is opened. Moved here from unloading, where the
// photo could only ever be taken AFTER the warehouse broke the seal — a screen that
// exists before the doors open is what makes "inspected before opened" a rule the
// server enforces, not an order photos happen to be taken in.
const AS_FOUND_INSTRUCTION =
  'Before anything is opened, record the seal exactly as you find it at the gate.'

const MISSING_PHOTO_INSTRUCTION =
  'Photograph where the seal should be. A missing seal is recorded as a finding, the same as any other.'
const PRESENT_PHOTO_INSTRUCTION =
  'Photograph the seal as found, before it is broken.'

const CONDITIONS: readonly { value: SealCondition; label: string }[] = [
  { value: 'intact', label: 'Intact' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'missing', label: 'Missing' },
]

interface ConditionChoiceProps {
  value: SealCondition | null
  onChange: (condition: SealCondition) => void
}

// Large touch targets, one tap each — a driver reading a physical seal at a gate is not
// the place for a dropdown. role="radiogroup"/"radio" mirrors native select-one
// semantics for assistive tech; Button's own `lg` size (min-h-[52px], w-full) is the
// app's documented large-touch-target treatment (see Button.tsx's own comment).
function ConditionChoice({ value, onChange }: ConditionChoiceProps) {
  return (
    // auto-fit on a rem minimum, not a fixed 3 columns: the three choices sit in a row at
    // normal text sizes and stack once Dynamic Type makes "Damaged" wider than a third of
    // the screen — at AX sizes a fixed grid pushed the word out of its own button.
    <div role="radiogroup" aria-label="Seal condition" className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
      {CONDITIONS.map((condition) => {
        const selected = value === condition.value
        return (
          <Button
            key={condition.value}
            type="button"
            role="radio"
            aria-checked={selected}
            variant={selected ? 'primary' : 'secondary'}
            size="lg"
            className={cn(!selected && 'text-surface-on')}
            onClick={() => onChange(condition.value)}
          >
            {condition.label}
          </Button>
        )
      })}
    </div>
  )
}

// Blind entry, same principle as unloading's own visual count: showing the driver the
// seal set at departure before they type invites copying, not verification.
// advance_arrival compares seal_number_at_arrival against this leg's own departure
// event server-side and raises a CRITICAL exception on any mismatch or compromise; the
// driver is never told the verdict — the swipe label stays neutral in every condition.
export function SealVerify({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealVerifyProps) {
  const { uploadNow } = useArtifactUpload(tripId)
  const isMissing = draft.sealCondition === 'missing'
  // Local, mirroring departure/CaptureSeal's own field — keeps typing responsive without
  // waiting on the parent's usePhaseDraft round-trip, same as every other seal input in
  // this app. Reset when switching to 'missing' clears the visible value alongside the
  // draft (see handleConditionChange), so a stale number can never reappear if the
  // driver switches back to 'intact'/'damaged'.
  const [input, setInput] = useState(draft.sealNumberAtArrival ?? '')
  const hasInput = input.trim().length > 0
  // The backend 422s any non-null seal number not matching XX-#### before its own
  // comparison runs, so format must still be caught here — but only when a number is
  // expected at all; a missing seal has nothing to validate.
  const formatValid = isMissing || isValidSealFormat(input)
  const showFormatHint = !isMissing && hasInput && !formatValid
  const numberSatisfied = isMissing || (hasInput && formatValid)
  const hasPhoto = draft.sealPhotoDataUrl !== null
  const isReady = draft.sealCondition !== null && numberSatisfied && hasPhoto

  // Upload starts at capture, not submit. Artifact id is cleared alongside the new data
  // URL so a re-shot photo can never submit under the previous shot's id.
  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
  }

  function handleConditionChange(condition: SealCondition) {
    // Clearing the number when the seal is missing rather than merely hiding the field:
    // a number left over from an earlier condition choice must never reach the wire
    // alongside a 'missing' condition.
    if (condition === 'missing') {
      setInput('')
      onUpdate({ sealCondition: condition, sealNumberAtArrival: null })
    } else {
      onUpdate({ sealCondition: condition })
    }
  }

  function handleInputChange(value: string) {
    // Stores the exact value isValidSealFormat checks, so a stray leading/trailing space
    // can never pass this screen's gate while still being what gets submitted.
    const normalized = normalizeSeal(value)
    setInput(normalized)
    onUpdate({ sealNumberAtArrival: normalized })
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro={AS_FOUND_INSTRUCTION}
      requirements={[
        { label: 'Seal condition', met: draft.sealCondition !== null },
        // A missing seal has no number to record, so it drops off the list entirely.
        ...(isMissing ? [] : [{ label: 'Seal number', met: numberSatisfied }]),
        { label: 'Seal photo', met: hasPhoto },
      ]}
      // Always "Swipe to Submit": the label must never leak the comparison result, in any
      // condition.
      action={<SwipeToConfirm label="Swipe to Submit" onConfirm={onComplete} disabled={!isReady} />}
    >

        <div className="flex flex-col gap-2">
          <p className="text-footnote font-semibold text-surface-on-variant">
            Seal condition
          </p>
          <ConditionChoice value={draft.sealCondition} onChange={handleConditionChange} />
        </div>

        {!isMissing && (
          <>
            <Input
              label="Seal number at arrival"
              placeholder="Type the seal number you see"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
            />
            {showFormatHint && (
              <p className="text-subhead text-error">
                Seal number must look like AB-1234 (two letters, four digits).
              </p>
            )}
          </>
        )}

        <div className="flex flex-col gap-3 border-t border-outline-variant/40 pt-6">
          <p className="text-body leading-relaxed text-surface-on-variant">
            {isMissing ? MISSING_PHOTO_INSTRUCTION : PRESENT_PHOTO_INSTRUCTION}
          </p>
          <CameraCapture
            label="Seal photo"
            dataUrl={draft.sealPhotoDataUrl}
            onCapture={handleSealPhoto}
          />
        </div>
    </StepLayout>
  )
}
