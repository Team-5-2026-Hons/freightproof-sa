'use client'

import { Input } from '@/components/ui/Input'
import { CameraCapture } from './CameraCapture'

interface SealInputProps {
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  onSealNumberChange: (value: string) => void
  onSealPhotoCapture: (dataUrl: string) => void
  requirePhoto?: boolean
}

export function SealInput({
  sealNumber,
  sealPhotoDataUrl,
  onSealNumberChange,
  onSealPhotoCapture,
  requirePhoto = true,
}: SealInputProps) {
  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Seal number"
        placeholder="e.g. FP-1234"
        value={sealNumber ?? ''}
        onChange={(e) => onSealNumberChange(e.target.value.toUpperCase())}
      />
      {requirePhoto && (
        <CameraCapture
          label="Seal photo"
          dataUrl={sealPhotoDataUrl}
          onCapture={onSealPhotoCapture}
        />
      )}
    </div>
  )
}
