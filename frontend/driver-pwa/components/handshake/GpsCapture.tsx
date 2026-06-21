'use client'

import { MapPin } from 'lucide-react'
import { useLocation } from '@/lib/hooks/useLocation'
import { Button } from '@/components/ui/Button'

interface GpsCaptureProps {
  onCapture: (lat: number, lng: number) => void
  captured: boolean   // true if draft already has coords
}

export function GpsCapture({ onCapture, captured }: GpsCaptureProps) {
  const { status, capture } = useLocation()

  async function handleCapture() {
    const result = await capture()
    if (result) onCapture(result.latitude, result.longitude)
  }

  if (captured) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3">
        <MapPin className="h-5 w-5 text-success" strokeWidth={2} aria-hidden />
        <p className="text-sm font-medium text-success">Location captured</p>
      </div>
    )
  }

  return (
    <Button
      onClick={handleCapture}
      loading={status === 'capturing'}
      disabled={status === 'capturing'}
      variant="secondary"
      size="lg"
    >
      {status === 'error' ? 'Retry GPS' : 'Capture GPS Location'}
    </Button>
  )
}
