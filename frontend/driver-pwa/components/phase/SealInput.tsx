'use client'

import { Input } from '@/components/ui/Input'
import { normalizeSeal } from '@/lib/utils/seal-format'
import { cn } from '@/lib/utils'
import { CameraCapture } from './CameraCapture'

interface SealInputProps {
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  /** When the seal photo was taken, for the captured tile's timestamp. */
  sealPhotoCapturedAt?: string | null
  /** Shown in place of the format hint, the moment the typed number can't be valid. */
  formatError?: string
  /** Replaces the default format hint, e.g. to say the number was read from the photo. */
  hint?: string
  /** True while OCR is reading the photo. The field stays editable throughout. */
  reading?: boolean
  onSealNumberChange: (value: string) => void
  onSealPhotoCapture: (dataUrl: string) => void
  requirePhoto?: boolean
}

const NOTE_ID = 'seal-number-note'
const DEFAULT_HINT = 'Two letters, a dash, four digits.'

export function SealInput({
  sealNumber,
  sealPhotoDataUrl,
  sealPhotoCapturedAt = null,
  formatError,
  hint,
  reading = false,
  onSealNumberChange,
  onSealPhotoCapture,
  requirePhoto = true,
}: SealInputProps) {
  const note = formatError ?? (reading ? 'Reading the seal…' : hint ?? DEFAULT_HINT)
  return (
    // Photo first: the number is read from it (lib/ocr/readSeal.ts), so taking it first is
    // what lets the field arrive already filled for the driver to check.
    <div className="flex flex-col gap-6">
      {requirePhoto && (
        <CameraCapture
          label="Seal photo"
          actionLabel="Photograph the seal"
          hint="Number readable, seal on the door"
          dataUrl={sealPhotoDataUrl}
          capturedAt={sealPhotoCapturedAt}
          onCapture={onSealPhotoCapture}
        />
      )}
      <div className="flex flex-col gap-2">
        <Input
          label="Seal number"
          placeholder="AB-1234"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={NOTE_ID}
          aria-invalid={formatError !== undefined || undefined}
          aria-busy={reading || undefined}
          value={sealNumber ?? ''}
          onChange={(e) => onSealNumberChange(normalizeSeal(e.target.value))}
          // The number is read off a physical seal and compared against one later, so it
          // is set like a plate: larger, tracked out, each character distinct.
          className={cn('text-title-3 tracking-wider', formatError !== undefined && 'ring-2 ring-error focus-visible:ring-error')}
        />
        {/* Not Input's own error: that waits for blur, and this one is a guaranteed
            backend 422 the driver should see while still typing. */}
        <p id={NOTE_ID} aria-live="polite" className={cn('text-footnote', formatError !== undefined ? 'font-medium text-error' : 'text-surface-on-variant')}>
          {note}
        </p>
      </div>
    </div>
  )
}
