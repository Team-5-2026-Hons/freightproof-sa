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

const ConditionChoice = memo(function ConditionChoice({ value, onChange }: ConditionChoiceProps) {
  return (
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

export function SealVerify({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: SealVerifyProps) {
  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)
  const isMissing = draft.sealCondition === 'missing'
  const [input, setInput] = useState(draft.sealNumberAtArrival ?? '')
  const { reading, readSeal } = useSealOcr()
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const hasInput = input.trim().length > 0
  const formatValid = isMissing || isValidSealFormat(input)
  const showFormatHint = !isMissing && hasInput && !formatValid
  const numberSatisfied = isMissing || (hasInput && formatValid)
  const hasPhoto = draft.sealPhotoDataUrl !== null
  const readPending = reading && !isMissing
  const isReady = draft.sealCondition !== null && numberSatisfied && hasPhoto && !readPending

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
      if (canReplaceWithOcr(current.sealNumberAtArrival, current.sealNumberAtArrivalOcr ?? null)) {
        setInput(result.value ?? '')
        onUpdateRef.current({ sealNumberAtArrivalOcr: result.value, sealNumberAtArrival: result.value })
      } else {
        onUpdateRef.current({ sealNumberAtArrivalOcr: null })
      }
    })
  }, [uploadNow, readSeal])

  const handleConditionChange = useCallback((condition: SealCondition) => {
    if (condition === 'missing') {
      setInput('')
      onUpdateRef.current({ sealCondition: condition, sealNumberAtArrival: null, sealNumberAtArrivalOcr: null })
    } else {
      onUpdateRef.current({ sealCondition: condition })
    }
  }, [])

  function handleInputChange(value: string) {
    const normalized = normalizeSeal(value)
    setInput(normalized)
    onUpdate({ sealNumberAtArrival: normalized })
  }

  const readFromPhoto = input !== '' && input === (draft.sealNumberAtArrivalOcr ?? null)

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
        ...(isMissing ? [] : [{ label: 'Seal number', met: numberSatisfied }]),
      ]}
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
            className={cn('text-title-3 tracking-wider', showFormatHint && 'ring-2 ring-error focus-visible:ring-error')}
          />
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
