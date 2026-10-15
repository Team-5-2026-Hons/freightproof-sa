'use client'

import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'

// Avatar-sized: shown at most ~104pt (3x = ~312px), so 512px covers every density with
// margin, and at 80% JPEG it stays a few tens of KB in localStorage.
const AVATAR_EDGE_PX = 512
const AVATAR_QUALITY_PERCENT = 80

/**
 * Lets the driver take or choose a profile photo. Resolves to a compressed JPEG data URL,
 * or null when they backed out. A refused camera permission is thrown, not swallowed —
 * the caller tells the driver how to allow it.
 */
export async function pickDriverPhoto(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        // The system sheet offering "Take Photo" or "Choose from Library" — a profile
        // photo is often one the driver already has.
        source: CameraSource.Prompt,
        width: AVATAR_EDGE_PX,
        quality: AVATAR_QUALITY_PERCENT,
      })
      return photo.dataUrl ?? null
    } catch (err) {
      // Same plugin message matching as CameraCapture: Capacitor gives no error code.
      const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (message.includes('cancel')) return null
      throw err
    }
  }

  const file = await chooseFile()
  return file === null ? null : fileToCompressedJpegDataUrl(file, AVATAR_EDGE_PX, AVATAR_QUALITY_PERCENT)
}

// No `capture` attribute: on a phone browser that would force the camera and hide the
// photo library, and a profile photo is often one the driver already has.
function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    // Fired by modern browsers when the picker is dismissed without a choice.
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
