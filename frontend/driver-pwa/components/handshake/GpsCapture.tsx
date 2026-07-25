'use client'

import { AlertTriangle, MapPin } from 'lucide-react'
import { useLocation, type LocationErrorReason } from '@/lib/hooks/useLocation'
import { Button } from '@/components/ui/Button'

interface GpsCaptureProps {
  onCapture: (lat: number, lng: number) => void
  captured: boolean   // true if draft already has coords
}

// Driver-facing copy per failure reason. permission_denied is called out as
// non-retryable in its own text — retrying does nothing until the driver leaves the
// app and flips the OS permission, so the button alone would be misleading here.
const ERROR_COPY: Record<LocationErrorReason, string> = {
  permission_denied:
    'Location permission is blocked for this app. Retrying won’t help — open your phone’s Settings and enable Location for this app, then come back.',
  timeout: 'GPS signal timed out. Move to open sky and try again.',
  position_unavailable: 'GPS position unavailable. Move to open sky and try again.',
  unknown: 'Could not get your location. Try again.',
}

export function GpsCapture({ onCapture, captured }: GpsCaptureProps) {
  const { status, errorReason, capture } = useLocation()

  async function handleCapture() {
    const result = await capture()
    if (result) onCapture(result.latitude, result.longitude)
  }

  if (captured) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 animate-fade-in-scale motion-reduce:animate-none">
        <MapPin className="h-5 w-5 text-success" strokeWidth={2} aria-hidden />
        <p className="text-sm font-medium text-success">Location captured</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {status === 'error' && (
        // Reason-specific remediation, not a bare retry prompt — permission_denied in
        // particular needs to tell the driver retrying won't work on its own.
        <p className="flex items-start gap-1.5 text-sm font-medium text-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {ERROR_COPY[errorReason ?? 'unknown']}
        </p>
      )}
      <div className="relative">
        {status === 'capturing' && (
          // Centered on the button (not left-aligned) since the button's content
          // (spinner + label) is itself centered, not left-anchored.
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -ml-2 -mt-2 h-4 w-4 rounded-full bg-secondary/40 animate-radar-pulse motion-reduce:animate-none"
          />
        )}
        <Button
          onClick={handleCapture}
          loading={status === 'capturing'}
          disabled={status === 'capturing'}
          variant="secondary"
          size="lg"
        >
          {status === 'error' ? 'Retry GPS' : 'Capture GPS Location'}
        </Button>
      </div>
    </div>
  )
}
