'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Camera as CameraIcon, Check } from 'lucide-react'
import { useToast } from '@/lib/hooks/useToast'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'
import { EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT, EVIDENCE_PHOTO_MAX_EDGE_PX } from '@/lib/constants/evidence-photo'
import { formatTime } from '@/lib/utils/format-time'
import {
  captureKey, claimRestoredPhoto, clearCapturePending, markCapturePending, subscribeRestoredPhoto,
} from '@/lib/camera/restored-photo'

interface CameraCaptureProps {
  /** What the photo is — the field label and the captured image's alt text. */
  label: string
  /** The tile's verb (overhaul 4.3: "Photograph the sheet"). Defaults to Take Photo. */
  actionLabel?: string
  /** One line under the verb on what makes a usable photo. */
  hint?: string
  dataUrl: string | null
  /** When the shown photo was taken (ISO), for the "Captured 09:58" chip. */
  capturedAt?: string | null
  /**
   * 'tile' (default) is the large evidence tile; 'row' is a compact line for an optional
   * photo on a longer form (overhaul 6.3), where a 196px tile would bury the submit.
   */
  variant?: 'tile' | 'row'
  /** The row variant's second line once a photo is added ("Sends with the report"). */
  capturedHint?: string
  onCapture: (dataUrl: string) => void
  /**
   * Native-only replacement for the camera, e.g. the document scanner for the linehaul
   * sheet. Resolves a JPEG data URL, or null when the driver backs out. Failures fall
   * back to the file picker exactly like a camera failure. The browser ignores it.
   */
  nativeSource?: () => Promise<string | null>
}

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

export function CameraCapture({
  label, actionLabel = 'Take Photo', hint, dataUrl, capturedAt = null, variant = 'tile', capturedHint, onCapture, nativeSource,
}: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  // Latches once the native camera has refused (permission denied, or no camera on the
  // device). From then on this control is a file picker, and says so, rather than a
  // button that reopens the same refusal every time it is tapped.
  const [nativeCameraUnavailable, setNativeCameraUnavailable] = useState(false)
  const { notify } = useToast()
  // Latest onCapture without re-subscribing below: callers pass inline closures.
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

  // A photo taken while Android killed the WebView comes back through CapacitorBridge,
  // not through getPhoto(). Claim it on mount (resume.ts has just put the driver back on
  // this step) or whenever it arrives while this control is already on screen.
  useEffect(() => {
    const key = captureKey(window.location.pathname, label)
    const claim = (): void => {
      const restored = claimRestoredPhoto(key)
      if (restored !== null) onCaptureRef.current(restored)
    }
    claim()
    return subscribeRestoredPhoto(claim)
  }, [label])

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
          onCapture(await fileToCompressedJpegDataUrl(file, EVIDENCE_PHOTO_MAX_EDGE_PX, EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT))
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

  // The picker the browser path always used, lifted out of handleCapture so the native
  // path can fall back to it too. The system file chooser needs no CAMERA permission —
  // which is exactly why it still works for a driver who has denied or revoked it.
  const openFilePicker = useCallback(() => {
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
  }, [handleBrowserFile])

  const handleCapture = useCallback(async () => {
    // Once the native camera has told us it cannot open — permission denied, or no
    // camera on the device — stop asking it and go straight to the picker. Re-invoking
    // a plugin that just refused only re-shows the same refusal.
    if (nativeCameraUnavailable || !Capacitor.isNativePlatform()) {
      openFilePicker()
      return
    }

    setIsCapturing(true)
    try {
      if (nativeSource !== undefined) {
        const dataUrl = await nativeSource()
        if (dataUrl !== null) onCapture(dataUrl)
        return
      }
      // Marked before the camera opens: if Android reclaims the WebView behind it, this
      // marker is the only thing that says which control the restored photo belongs to.
      markCapturePending(captureKey(window.location.pathname, label))
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
        // Native-side downscale, applied before the image crosses the bridge as
        // base64 — same cap as the browser path's canvas step.
        width: EVIDENCE_PHOTO_MAX_EDGE_PX,
      })
      if (photo.dataUrl) onCapture(photo.dataUrl)
    } catch (err) {
      // Without this catch, every native failure silently reset the button — a driver
      // with camera permission blocked could tap forever with zero feedback.
      switch (classifyCameraFailure(err)) {
        case 'cancelled':
          // The driver backed out of the camera on purpose — feedback would be noise.
          break
        case 'permission-denied':
          // Offer the way through, not just the reason it failed. A driver at a gate
          // cannot stop to change OS settings, and this photo is the evidence; the
          // picker still reaches the camera roll (and, on most Android choosers, the
          // camera itself) with no CAMERA permission of its own.
          setNativeCameraUnavailable(true)
          notify({
            kind: 'error',
            title: 'Camera access is blocked',
            body: "Enable Camera in your phone's settings, or tap again to choose a photo instead.",
          })
          break
        case 'other':
          // Could be a device with no camera at all, which fails here exactly like any
          // other plugin error. Either way the picker is the remaining route to a photo.
          console.error('Camera capture failed', err)
          setNativeCameraUnavailable(true)
          notifyCaptureFailed()
      }
    } finally {
      // The camera answered this session, so there is nothing left to restore.
      clearCapturePending()
      setIsCapturing(false)
    }
  }, [onCapture, notify, notifyCaptureFailed, openFilePicker, nativeCameraUnavailable, nativeSource, label])

  const verb = isCapturing ? 'Opening Camera…' : nativeCameraUnavailable ? 'Choose a Photo Instead' : actionLabel

  if (variant === 'row') {
    return dataUrl ? (
      <div className="grid grid-cols-[64px_1fr_auto] items-center gap-x-3 animate-fade-in-scale motion-reduce:animate-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt={label} className="h-14 w-16 rounded-xl object-cover" />
        <div className="min-w-0">
          <p className="text-headline text-surface-on">Photo added</p>
          {capturedHint !== undefined && <p className="text-subhead text-surface-on-variant">{capturedHint}</p>}
        </div>
        <button
          type="button"
          onClick={handleCapture}
          className="flex min-h-11 items-center"
        >
          <span className="inline-flex h-9 items-center rounded-full bg-fill px-4 text-subhead font-semibold text-surface-on active:scale-95">Retake</span>
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={handleCapture}
        disabled={isCapturing}
        className="grid min-h-14 w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[14px] bg-fill px-4 py-2 text-left transition-transform duration-150 active:scale-[0.99] active:bg-surface-container-high disabled:opacity-60"
      >
        <CameraIcon className="size-5 text-surface-on" strokeWidth={1.9} aria-hidden />
        <span className="text-headline text-surface-on">{verb}</span>
        {hint !== undefined && <span className="text-subhead text-surface-on-variant">{hint}</span>}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* A tile with a hint already says what it is for; a second label above it would
          say it twice. Only a bare tile carries the label. */}
      {hint === undefined && <p className="text-subhead text-surface-on-variant">{label}</p>}
      {dataUrl ? (
        <div
          // A fixed aspect-video frame, so the preview reads as a bounded card rather than
          // an image at whatever height the photo happens to be.
          className="relative aspect-video w-full overflow-hidden rounded-[20px] bg-surface-container-high animate-fade-in-scale motion-reduce:animate-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
          {/* Scrim chips, not page tokens: they sit on an arbitrary photo, so they carry
              their own contrast whatever the theme. */}
          <span className="absolute bottom-3 left-3 inline-flex h-[30px] items-center gap-1.5 rounded-full bg-black/60 px-3 text-footnote font-semibold text-white">
            <Check className="size-3 text-success" strokeWidth={3} aria-hidden />
            {capturedAt === null ? 'Captured' : `Captured ${formatTime(capturedAt)}`}
          </span>
          <button
            type="button"
            onClick={handleCapture}
            className="absolute bottom-3 right-3 h-9 rounded-full bg-white px-4 text-subhead font-semibold text-black shadow-ambient-sm transition-transform duration-100 active:scale-95"
          >
            Retake
          </button>
        </div>
      ) : (
        // A tappable tile, not a dashed drop zone: dashes are the desktop "drag a file
        // here" idiom, and there is nothing to drag on a phone. The ink disc and the verb
        // say what a tap does; it dips on press like every other control.
        <button
          type="button"
          onClick={handleCapture}
          disabled={isCapturing}
          className="flex h-[196px] w-full flex-col items-center justify-center gap-2.5 rounded-[20px] bg-fill px-6 text-center transition-transform duration-150 active:scale-[0.98] active:bg-surface-container-high disabled:opacity-60 animate-fade-in-scale motion-reduce:animate-none"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-surface-on text-surface">
            <CameraIcon className="size-6" strokeWidth={1.9} aria-hidden />
          </span>
          <span className="text-headline text-surface-on">{verb}</span>
          {hint !== undefined && <span className="text-subhead text-surface-on-variant">{hint}</span>}
        </button>
      )}
    </div>
  )
}
