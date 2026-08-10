'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Camera as CameraIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/hooks/useToast'

interface CameraCaptureProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

// Longest-edge cap applied on BOTH capture paths. Captured photos live as base64 data
// URLs in React state and localStorage evidence drafts (lib/types/evidence-draft.ts) —
// an uncompressed phone photo is 5–12 MB, which blows the ~5 MB localStorage quota and
// guarantees rejection against the backend's 10 MB artifact cap. 1600px keeps seals and
// documents legible at a fraction of the size.
const MAX_PHOTO_EDGE_PX = 1600

// Single JPEG quality constant for both paths — Capacitor's `quality` option is 0–100,
// canvas.toDataURL takes 0–1; both derive from this so the two paths can't drift apart.
const JPEG_QUALITY_PERCENT = 70

type CameraFailure = 'cancelled' | 'permission-denied' | 'other'

// The Capacitor bridge surfaces native camera failures as plain Error/CapacitorException
// objects carrying only a message string — there is no structured error code. The
// plugin's own sources hardcode "User cancelled photos app" and "User denied access to
// camera"/"photos" (iOS/Android CameraPlugin and web.js alike, @capacitor/camera 6.x),
// so defensive substring matching is the only classification available. Matched loosely
// ("cancel"/"denied"/"permission") in case the wording shifts between plugin versions.
function classifyCameraFailure(err: unknown): CameraFailure {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('denied') || message.includes('permission')) return 'permission-denied'
  return 'other'
}

interface DecodedPhoto {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  // Frees decode resources (bitmap memory / object URL) once the canvas draw is done.
  release: () => void
}

// createImageBitmap with imageOrientation: 'from-image' bakes the EXIF rotation in at
// decode time, so portrait phone photos don't land sideways on the canvas. WebViews that
// lack the option (or can't decode the format) fall back to an <img> decode — browsers
// have auto-oriented <img> per EXIF by default since 2020 (CSS image-orientation:
// from-image), so orientation survives that path too.
async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch (err) {
      // Not fatal — some WebViews reject the options bag or the file format. The <img>
      // fallback below gets its own shot at decoding before we give up.
      console.warn('createImageBitmap failed — falling back to <img> decode', err)
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Image decode failed'))
      img.src = objectUrl
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      // The object URL must stay alive until drawImage has consumed it — release
      // revokes it only after the caller is done drawing.
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

// Downscale + re-encode the picked file BEFORE it reaches state/localStorage. The old
// raw FileReader path stored multi-MB base64 strings — quota risk for drafts and a
// guaranteed oversized upload later (see MAX_PHOTO_EDGE_PX above).
async function fileToCompressedJpegDataUrl(file: File): Promise<string> {
  const decoded = await decodePhoto(file)
  try {
    const scale = Math.min(1, MAX_PHOTO_EDGE_PX / Math.max(decoded.width, decoded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY_PERCENT / 100)
  } finally {
    decoded.release()
  }
}

export function CameraCapture({ label, dataUrl, onCapture }: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  const { notify } = useToast()

  const notifyCaptureFailed = useCallback(() => {
    notify({
      kind: 'error',
      title: 'Could not add the photo',
      body: 'Something went wrong with the camera. Try taking the photo again.',
    })
  }, [notify])

  // Browser-path file handling runs OUTSIDE handleCapture's try/catch — the input's
  // onchange fires long after handleCapture has returned — so it needs its own error
  // handling end to end.
  const handleBrowserFile = useCallback(
    (file: File) => {
      void (async () => {
        try {
          onCapture(await fileToCompressedJpegDataUrl(file))
        } catch (err) {
          // Decode/canvas failed (exotic format, out of memory). Fall back to the raw
          // FileReader read this component always used — an oversized draft beats
          // losing evidence entirely.
          console.warn('Photo compression failed — falling back to the raw file', err)
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') onCapture(reader.result)
          }
          // Previously unhandled: a reader failure (file removed mid-read, storage
          // error) silently produced no photo and no feedback for the driver.
          reader.onerror = () => {
            console.error('Failed to read captured photo', reader.error)
            notifyCaptureFailed()
          }
          reader.readAsDataURL(file)
        }
      })()
    },
    [onCapture, notifyCaptureFailed],
  )

  const handleCapture = useCallback(async () => {
    setIsCapturing(true)
    try {
      if (Capacitor.isNativePlatform()) {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: JPEG_QUALITY_PERCENT,
          // Native-side downscale, applied before the image crosses the bridge as
          // base64 — same cap as the browser path's canvas step.
          width: MAX_PHOTO_EDGE_PX,
        })
        if (photo.dataUrl) onCapture(photo.dataUrl)
      } else {
        // Browser fallback: file input with environment camera hint
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.capture = 'environment'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return
          handleBrowserFile(file)
        }
        input.click()
      }
    } catch (err) {
      // Without this catch, every native failure silently reset the button — a driver
      // with camera permission blocked could tap forever with zero feedback.
      switch (classifyCameraFailure(err)) {
        case 'cancelled':
          // The driver backed out of the camera on purpose — feedback would be noise.
          break
        case 'permission-denied':
          notify({
            kind: 'error',
            title: 'Camera access is blocked',
            body: "Enable Camera for this app in your phone's settings, then try again.",
          })
          break
        case 'other':
          console.error('Camera capture failed', err)
          notifyCaptureFailed()
      }
    } finally {
      setIsCapturing(false)
    }
  }, [onCapture, notify, notifyCaptureFailed, handleBrowserFile])

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      {dataUrl ? (
        <div
          // Fixed aspect-video frame + border so the preview reads as a bounded card instead of
          // an unframed image merging with the page at whatever height the photo happens to be.
          className="relative aspect-video w-full rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-low animate-fade-in-scale motion-reduce:animate-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCapture}
            // Overrides ghost's uppercase/bold/transparent defaults back to the original
            // floating pill look: rounded-full, a visible scrim so it reads over any
            // photo, and normal-case/font-medium text. Shadow lifts it off the photo so
            // it reads as a floating control, not part of the image.
            className="absolute bottom-2 right-2 rounded-full bg-surface-container-highest/90 font-medium normal-case tracking-normal shadow-ambient-sm hover:bg-surface-container-highest"
          >
            Retake
          </Button>
        </div>
      ) : (
        <button
          onClick={handleCapture}
          disabled={isCapturing}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low text-sm text-surface-on-variant disabled:opacity-60 animate-fade-in-scale motion-reduce:animate-none"
        >
          <CameraIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden />
          {isCapturing ? 'Opening camera…' : 'Tap to photograph'}
        </button>
      )}
    </div>
  )
}
