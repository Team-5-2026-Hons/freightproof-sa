// frontend/driver-pwa/lib/ocr/sealSource.ts
//
// How the seal number on a departure or arrival was entered. Sent as seal_number_source,
// stored server-side and never anchored (spec D6). Kept local to this app: the dispatcher
// reads it from the API, and shared/ is not changed for a value only this app produces.
export type SealNumberSource = 'ocr_confirmed' | 'ocr_corrected' | 'typed'

export function sealNumberSource(ocrValue: string | null, finalValue: string): SealNumberSource {
  if (ocrValue === null) return 'typed'
  return ocrValue === finalValue ? 'ocr_confirmed' : 'ocr_corrected'
}

// A new OCR result may replace the field only while the driver has not made it their own:
// empty, or still exactly what the previous read put there. Their typing is never lost.
export function canReplaceWithOcr(current: string | null, previousOcr: string | null): boolean {
  if (current === null || current.trim() === '') return true
  return previousOcr !== null && current === previousOcr
}
