'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Camera as CameraIcon } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

interface CameraCaptureProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

export function CameraCapture({ label, dataUrl, onCapture }: CameraCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  const reduceMotion = useReducedMotion()

  const handleCapture = useCallback(async () => {
    setIsCapturing(true)
    try {
      if (Capacitor.isNativePlatform()) {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: 70,
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
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') onCapture(reader.result)
          }
          reader.readAsDataURL(file)
        }
        input.click()
      }
    } finally {
      setIsCapturing(false)
    }
  }, [onCapture])

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <AnimatePresence mode="wait" initial={false}>
        {dataUrl ? (
          <motion.div
            key="captured"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative rounded-xl overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt={label} className="w-full max-h-48 object-cover" />
            <button
              onClick={handleCapture}
              className="absolute bottom-2 right-2 rounded-full bg-surface-container-highest/90 px-3 py-1 text-xs font-medium"
            >
              Retake
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="empty"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            onClick={handleCapture}
            disabled={isCapturing}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low text-sm text-surface-on-variant disabled:opacity-60"
          >
            <CameraIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            {isCapturing ? 'Opening camera…' : 'Tap to photograph'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
