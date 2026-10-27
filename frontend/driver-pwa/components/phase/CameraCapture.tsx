'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Camera as CameraIcon, Check } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/lib/hooks/useToast'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'
import { EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT, EVIDENCE_PHOTO_MAX_EDGE_PX } from '@/lib/constants/evidence-photo'
import { formatTime } from '@/lib/utils/format-time'
import {
  captureKey, claimRestoredPhoto, clearCapturePending, markCapturePending, subscribeRestoredPhoto,
} from '@/lib/camera/restored-photo'

interface CameraCaptureProps {
  label: string
  actionLabel?: string
  hint?: string
  dataUrl: string | null
  capturedAt?: string | null
  variant?: 'tile' | 'row'
  capturedHint?: string
  onCapture: (dataUrl: string) => void
  /**
   * Native-only replacement for the camera, e.g. the document scanner for the linehaul
   * sheet. Resolves a JPEG data URL, or null when the driver backs out. Failures fall
   * back to the file picker exactly like a camera failure. The browser ignores it.
   */
  nativeSource?: () => Promise<string | null>
  busy?: boolean
  busyLabel?: string
}

type CameraFailure = 'cancelled' | 'permission-denied' | 'other'

function classifyCameraFailure(err: unknown): CameraFailure {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('denied') || message.includes('permission')) return 'permission-denied'
  return 'other'
}

export function CameraCapture({
  label, actionLabel = 'Take Photo', hint, dataUrl, capturedAt = null, variant = 'tile', capturedHint, onCapture, nativeSource,
  busy = false, busyLabel = 'Processing',
}: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [nativeCameraUnavailable, setNativeCameraUnavailable] = useState(false)
  const { notify } = useToast()
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

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

  const handleBrowserFile = useCallback(
    (file: File) => {
      void (async () => {
        try {
          onCapture(await fileToCompressedJpegDataUrl(file, EVIDENCE_PHOTO_MAX_EDGE_PX, EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT))
        } catch (err) {
          console.warn('Photo compression failed — falling back to the raw file', err)
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') onCapture(reader.result)
          }
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
      markCapturePending(captureKey(window.location.pathname, label))
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
        width: EVIDENCE_PHOTO_MAX_EDGE_PX,
      })
      if (photo.dataUrl) onCapture(photo.dataUrl)
    } catch (err) {
      switch (classifyCameraFailure(err)) {
        case 'cancelled':
          break
        case 'permission-denied':
          setNativeCameraUnavailable(true)
          notify({
            kind: 'error',
            title: 'Camera access is blocked',
            body: "Enable Camera in your phone's settings, or tap again to choose a photo instead.",
          })
          break
        case 'other':
          console.error('Camera capture failed', err)
          setNativeCameraUnavailable(true)
          notifyCaptureFailed()
      }
    } finally {
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
      {hint === undefined && <p className="text-subhead text-surface-on-variant">{label}</p>}
      {dataUrl ? (
        <div
          className="relative aspect-video w-full overflow-hidden rounded-[20px] bg-surface-container-high animate-fade-in-scale motion-reduce:animate-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
          {busy && (
            <div
              role="status"
              aria-label={busyLabel}
              className="absolute inset-0 flex items-center justify-center bg-black/35"
            >
              <span aria-hidden>
                <Spinner size="lg" className="border-white/40 border-t-white" />
              </span>
            </div>
          )}
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
