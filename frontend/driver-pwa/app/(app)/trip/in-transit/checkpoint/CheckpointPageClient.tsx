// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'

// Driver-initiated periodic in-transit capture (selfie + cargo photo), independent
// of the five handshakes — proves the driver and cargo are where they should be
// between Origin Gate-Out and Destination Gate-In.
export default function CheckpointPageClient() {
  const router = useRouter()
  const { trip } = useTrip()
  const { notify } = useToast()
  const { enqueueCheckpoint } = useOfflineQueue()

  // GpsCapture owns its own internal useLocation() instance — coords are lifted
  // here via its onCapture callback, not read from a second, independent hook call.
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null)
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null)
  const [cargoPhotoDataUrl, setCargoPhotoDataUrl] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [isDeviation, setIsDeviation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)

  const isReady = gps !== null && selfieDataUrl !== null && cargoPhotoDataUrl !== null

  async function handleSubmit() {
    if (!isReady || !trip) return
    setSubmitting(true)
    setSubmitError(false)

    const evidence: CheckpointEvidence = {
      gpsLat: gps!.latitude,
      gpsLng: gps!.longitude,
      selfieDataUrl: selfieDataUrl!,
      cargoPhotoDataUrl: cargoPhotoDataUrl!,
      note: note.trim(),
      isDeviation,
      capturedAt: new Date().toISOString(),
    }

    try {
      await submitCheckpoint(String(trip.id), evidence)
      router.push(ROUTES.inTransit)
    } catch (err) {
      // A 4xx (validation failure) will fail identically on retry — leave the driver
      // here with the inline error so they can fix/retry manually. A network failure
      // or 5xx is retryable, so queue it (same offline-queue pattern handshakes and
      // exceptions use) and let the driver move on; it syncs on reconnect.
      const isRetryable = !(err instanceof ApiError) || err.status >= 500
      if (isRetryable) {
        console.error('Failed to log checkpoint — queued for retry', err)
        enqueueCheckpoint(String(trip.id), evidence)
        notify({
          kind: 'success',
          title: 'Checkpoint recorded',
          body: 'Saved — evidence stored on this device.',
        })
        router.push(ROUTES.inTransit)
      } else {
        console.error('Failed to log checkpoint', err)
        setSubmitError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!trip) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
          <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold">Unable to verify trip</h1>
          <p className="text-sm opacity-90">
            We could not confirm this checkpoint against your active trip.
            Return to in-transit and try again.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={() => router.replace(ROUTES.inTransit)}>
          Return to in-transit
        </Button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col">
      <SubpageHeader
        title="Log Checkpoint"
        backLabel="In-Transit Hub"
        onBack={() => router.push(ROUTES.inTransit)}
      />
      {/* pb-8 keeps the hold button clear of the note textarea on short viewports —
          min-h-screen alone lets the footer controls crowd the form when it overflows. */}
      <div className="flex flex-1 flex-col p-4 pb-8">
        <p className="mb-6 text-sm text-surface-on-variant">
          Capture a selfie and a cargo photo to confirm your location and load mid-transit.
        </p>

        <div className="flex flex-col gap-6 mb-6">
          <GpsCapture onCapture={(lat, lng) => setGps({ latitude: lat, longitude: lng })} captured={gps !== null} />
          <CameraCapture label="Selfie" dataUrl={selfieDataUrl} onCapture={setSelfieDataUrl} />
          <CameraCapture label="Cargo photo" dataUrl={cargoPhotoDataUrl} onCapture={setCargoPhotoDataUrl} />

          {/* The visual checkbox stays 16px, but the whole label is the tap target —
              min-h-[44px] meets the app's documented 44px minimum touch target (same
              pattern Switch.tsx documents: grow the hit area, not the control, so it
              doesn't look oversized next to its text). */}
          <label className="flex min-h-[44px] cursor-pointer select-none items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={isDeviation}
              onChange={(e) => setIsDeviation(e.target.checked)}
              className="h-4 w-4"
            />
            This is a route deviation
          </label>

          <TextArea
            label="Note"
            helperText="Optional"
            rows={3}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {submitError && (
          // This branch only renders on a terminal 4xx — retrying with the same input
          // cannot succeed, so "check your connection" would be actively misleading here
          // (the connection worked; the server said no).
          <p className="mb-3 text-sm text-error">
            Could not submit — the checkpoint was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
        <div className="flex flex-col items-center pb-safe">
          <div className="flex justify-center">
            <HoldButton label={submitting ? 'Submitting…' : 'Hold to confirm'} onConfirm={handleSubmit} disabled={!isReady || submitting} />
          </div>
          <Button variant="secondary" size="lg" className="mt-4" onClick={() => router.push(ROUTES.inTransit)}>
            Cancel
          </Button>
        </div>
      </div>
    </main>
  )
}
