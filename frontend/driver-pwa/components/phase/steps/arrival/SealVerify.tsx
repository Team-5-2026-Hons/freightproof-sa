'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { Input } from '@/components/ui/Input'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { CircleDashed, Lock, Unlink, type LucideIcon } from 'lucide-react'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { useSealOcr } from '@/lib/hooks/useSealOcr'
import { canReplaceWithOcr } from '@/lib/ocr/sealSource'
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

const CONDITIONS: readonly { value: SealCondition; label: string; Icon: LucideIcon }[] = [
  { value: 'intact', label: 'Intact', Icon: Lock },
  { value: 'damaged', label: 'Damaged', Icon: Unlink },
  { value: 'missing', label: 'Missing', Icon: CircleDashed },
]

const NOTE_ID = 'arrival-seal-note'

interface ConditionChoiceProps {
  value: SealCondition | null
  onChange: (condition: SealCondition) => void
}

// Large tiles, one tap each — a driver reading a physical seal at a gate is not the place
// for a dropdown. role="radiogroup"/"radio" mirrors native select-one semantics.
// Memoised, with the photo tile below: every keystroke in the seal number re-renders this
// step (51-124 ms per key at 4x CPU throttling), and neither depends on what is typed.
const ConditionChoice = memo(function ConditionChoice({ value, onChange }: ConditionChoiceProps) {
  return (
    // auto-fit on a rem minimum, not a fixed 3 columns: the three sit in a row at normal
    // text sizes and stack once Dynamic Type makes "Damaged" wider than a third of the
    // screen — at AX sizes a fixed grid pushed the word out of its own tile.
    <div role="radiogroup" aria-label="Seal condition" className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2.5">
      {CONDITIONS.map(({ value: condition, label, Icon }) => {
        const selected = value === condition
        return (
          <button
            key={condition}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(condition)}
            className={cn(
              'flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-[18px] text-body font-semibold transition-transform duration-100 active:scale-[0.97]',
              selected ? 'bg-surface-on text-surface' : 'bg-fill text-surface-on',
            )}
          >
            <Icon className="size-6" strokeWidth={1.9} aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
})

const SealPhoto = memo(CameraCapture)

// Blind entry, same principle as unloading's own visual count: showing the driver the
// seal set at departure before they type invites copying, not verification.
// advance_arrival compares seal_number_at_arrival against this leg's own departure
// event server-side and raises a CRITICAL exception on any mismatch or compromise; the
// driver is never told the verdict — the swipe label stays neutral in every condition.
export function SealVerify({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealVerifyProps) {
  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)
  const isMissing = draft.sealCondition === 'missing'
  // Local state keeps typing responsive without waiting on the parent's usePhaseDraft
  // round-trip. Switching to 'missing' clears the visible value alongside the draft (see
  // handleConditionChange), so a stale number can never reappear if the driver switches
  // back to 'intact'/'damaged'.
  const [input, setInput] = useState(draft.sealNumberAtArrival ?? '')
  const { reading, readSeal } = useSealOcr()
  // Judged when the OCR answer arrives, not when the photo was taken (see CaptureSeal).
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  // The host passes a new onUpdate each render; read through a ref so the handlers handed
  // to the memoised children below stay the same function across keystrokes.
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const hasInput = input.trim().length > 0
  // The backend 422s any non-null seal number not matching XX-#### before its own
  // comparison runs, so format must still be caught here — but only when a number is
  // expected at all; a missing seal has nothing to validate.
  const formatValid = isMissing || isValidSealFormat(input)
  const showFormatHint = !isMissing && hasInput && !formatValid
  const numberSatisfied = isMissing || (hasInput && formatValid)
  const hasPhoto = draft.sealPhotoDataUrl !== null
  // A read still running blocks the swipe: submitting inside that window would send a
  // capture tag worked out from the previous photo's read. A missing seal sends no number
  // and no tag, so a read it has made irrelevant does not hold the driver up.
  const readPending = reading && !isMissing
  const isReady = draft.sealCondition !== null && numberSatisfied && hasPhoto && !readPending

  // Upload starts at capture, not submit. Artifact id is cleared alongside the new data
  // URL so a re-shot photo can never submit under the previous shot's id.
  //
  // OCR stays blind entry: it reads the physical seal in this photo, never paperwork and
  // never the departure value. A missing seal has nothing to read.
  const handleSealPhoto = useCallback((dataUrl: string) => {
    const onUpdate = onUpdateRef.current
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'seal_photo').then((artifactId) => {
      if (artifactId !== null) onUpdateRef.current({ sealPhotoArtifactId: artifactId })
    })
    if (draftRef.current.sealCondition === 'missing') return
    void readSeal(dataUrl).then((result) => {
      const current = draftRef.current
      if (result.stale || current.sealCondition === 'missing') return
      // Credited only when OCR actually fills the field, as at departure (see CaptureSeal):
      // a retake that reads nothing clears an untouched earlier read, and once the driver
      // has made the field their own their number stands and submits as "typed".
      if (canReplaceWithOcr(current.sealNumberAtArrival, current.sealNumberAtArrivalOcr ?? null)) {
        setInput(result.value ?? '')
        onUpdateRef.current({ sealNumberAtArrivalOcr: result.value, sealNumberAtArrival: result.value })
      } else {
        onUpdateRef.current({ sealNumberAtArrivalOcr: null })
      }
    })
  }, [uploadNow, readSeal])

  const handleConditionChange = useCallback((condition: SealCondition) => {
    // Clearing the number when the seal is missing rather than merely hiding the field:
    // a number left over from an earlier condition choice must never reach the wire
    // alongside a 'missing' condition.
    if (condition === 'missing') {
      setInput('')
      onUpdateRef.current({ sealCondition: condition, sealNumberAtArrival: null, sealNumberAtArrivalOcr: null })
    } else {
      onUpdateRef.current({ sealCondition: condition })
    }
  }, [])

  function handleInputChange(value: string) {
    // Stores the exact value isValidSealFormat checks, so a stray leading/trailing space
    // can never pass this screen's gate while still being what gets submitted.
    const normalized = normalizeSeal(value)
    setInput(normalized)
    onUpdate({ sealNumberAtArrival: normalized })
  }

  const readFromPhoto = input !== '' && input === (draft.sealNumberAtArrivalOcr ?? null)

  // The waiting swipe names the next missing thing, in the order the screen asks for them.
  const waitingLabel = draft.sealCondition === null
    ? 'Choose the seal condition'
    : readPending
      ? 'Reading the seal…'
      : !hasPhoto ? 'Add the photo first' : 'Add the seal number'

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro={AS_FOUND_INSTRUCTION}
      requirements={[
        { label: 'Seal condition', met: draft.sealCondition !== null },
        { label: 'Seal photo', met: hasPhoto },
        // A missing seal has no number to record, so it drops off the list entirely.
        ...(isMissing ? [] : [{ label: 'Seal number', met: numberSatisfied }]),
      ]}
      // One label in every condition: it must never leak the comparison result.
      action={<SwipeToConfirm label="Swipe to Record Seal" waitingLabel={waitingLabel} onConfirm={onComplete} disabled={!isReady} />}
    >
      <section className="flex flex-col gap-2.5">
        <h2 className="text-subhead font-semibold text-surface-on-variant">Seal condition</h2>
        <ConditionChoice value={draft.sealCondition} onChange={handleConditionChange} />
      </section>

      <SealPhoto
        label="Seal photo"
        actionLabel={isMissing ? 'Photograph the door latch' : 'Photograph the seal'}
        hint={isMissing ? 'Where the seal should be' : 'As found, before it is broken'}
        dataUrl={draft.sealPhotoDataUrl}
        capturedAt={draft.capturedAt}
        onCapture={handleSealPhoto}
      />

      {isMissing ? (
        <StatusBanner tone="attention" title="Recorded as a finding">
          A missing seal is evidence like any other. Photograph where it should be.
        </StatusBanner>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            label="Seal number you see"
            placeholder="AB-1234"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={NOTE_ID}
            aria-invalid={showFormatHint || undefined}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            // Set like a plate, as at departure: larger, tracked out, each character distinct.
            className={cn('text-title-3 tracking-wider', showFormatHint && 'ring-2 ring-error focus-visible:ring-error')}
          />
          {/* Blind entry is the point: the number must come off the seal itself. */}
          <p id={NOTE_ID} aria-live="polite" className={cn('text-footnote', showFormatHint ? 'font-medium text-error' : 'text-surface-on-variant')}>
            {showFormatHint
              ? 'Seal number must look like AB-1234 (two letters, four digits).'
              : reading
                ? 'Reading the seal…'
                : readFromPhoto
                  ? 'Read from the photo. Check it matches the seal.'
                  : 'Type what is printed. Don’t copy it from paperwork.'}
          </p>
        </div>
      )}
    </StepLayout>
  )
}
