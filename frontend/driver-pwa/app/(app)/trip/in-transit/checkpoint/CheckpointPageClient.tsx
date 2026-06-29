// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'
import { uploadArtifact } from '@/lib/api/artifacts'
import { logCheckpoint } from '@/lib/api/checkpoints'

// Driver-initiated periodic in-transit capture (selfie + cargo photo), independent
// of the five handshakes — proves the driver and cargo are where they should be
// between Origin Gate-Out and Destination Gate-In.
export default function CheckpointPageClient() {
  const router = useRouter()
  const { trip } = useTrip()

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
    try {
      const capturedAt = new Date().toISOString()
      const [selfie, cargoPhoto] = await Promise.all([
        uploadArtifact({ tripId: String(trip.id), artifactType: 'photo', dataUrl: selfieDataUrl!, capturedAt }),
        uploadArtifact({ tripId: String(trip.id), artifactType: 'photo', dataUrl: cargoPhotoDataUrl!, capturedAt }),
      ])
      await logCheckpoint(String(trip.id), {
        checkpoint_type: 'manual',
        driver_phone_lat: gps?.latitude,
        driver_phone_lng: gps?.longitude,
        selfie_artifact_id: selfie.id,
        cargo_photo_artifact_id: cargoPhoto.id,
        note: note.trim() || undefined,
        is_deviation: isDeviation,
      })
      router.push(ROUTES.inTransit)
    } catch (err) {
      console.error('Failed to log checkpoint', err)
      setSubmitError(true)
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
        <button
          onClick={() => router.replace(ROUTES.inTransit)}
          className="text-sm text-secondary underline"
        >
          Return to in-transit
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col p-4">
      <button onClick={() => router.back()} className="mb-4 text-sm text-secondary">← Back</button>
      <h1 className="text-xl font-bold mb-1">Log Checkpoint</h1>
      <p className="mb-6 text-sm text-surface-on-variant">
        Capture a selfie and a cargo photo to confirm your location and load mid-transit.
      </p>

      <div className="flex flex-col gap-6 mb-6">
        <GpsCapture onCapture={(lat, lng) => setGps({ latitude: lat, longitude: lng })} captured={gps !== null} />
        <CameraCapture label="Selfie" dataUrl={selfieDataUrl} onCapture={setSelfieDataUrl} />
        <CameraCapture label="Cargo photo" dataUrl={cargoPhotoDataUrl} onCapture={setCargoPhotoDataUrl} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDeviation}
            onChange={(e) => setIsDeviation(e.target.checked)}
            className="h-4 w-4"
          />
          This is a route deviation
        </label>

        <textarea
          className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-sm resize-none"
          rows={3}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {submitError && (
        <p className="mb-3 text-sm text-error">Could not submit — check your connection and try again.</p>
      )}
      <div className="flex justify-center">
        <HoldButton label={submitting ? 'Submitting…' : 'Hold to confirm'} onConfirm={handleSubmit} disabled={!isReady || submitting} />
      </div>
      <Button variant="secondary" size="lg" className="mt-4" onClick={() => router.back()}>
        Cancel
      </Button>
    </main>
  )
}
