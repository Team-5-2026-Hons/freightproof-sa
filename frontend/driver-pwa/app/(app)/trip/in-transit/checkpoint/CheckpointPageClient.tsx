// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { Switch } from '@/components/ui/Switch'
import { RequirementChecklist } from '@/components/phase/StepLayout'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { markTransition } from '@/lib/navigation/transition-direction'

// Driver-initiated periodic in-transit capture (selfie + cargo photo), independent
// of the five handshakes — proves the driver and cargo are where they should be
// between Origin Gate-Out and Destination Gate-In.
export default function CheckpointPageClient() {
  const router = useRouter()
  const { trip } = useTrip()
  const { notify } = useToast()
  const { enqueueCheckpoint } = useOfflineQueue()
  // The driver no longer taps to capture a position here either — it is taken as the
  // checkpoint is submitted, like every other evidence surface in the app.
  const { capturePosition } = useLocationTrail()
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null)
  const [cargoPhotoDataUrl, setCargoPhotoDataUrl] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [isDeviation, setIsDeviation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const clientReportIdRef = useRef<string | null>(null)

  // GPS is no longer a gate: it is captured silently at submit, and a checkpoint with
  // photos but no fix is still evidence worth recording. The two photos ARE the
  // checkpoint, so they stay required.
  const isReady = selfieDataUrl !== null && cargoPhotoDataUrl !== null

  async function handleSubmit() {
    if (!isReady || !trip) return
    setSubmitting(true)
    setSubmitError(false)

    const position = await capturePosition()
    const clientReportId = clientReportIdRef.current ?? crypto.randomUUID()
    clientReportIdRef.current = clientReportId
    const evidence: CheckpointEvidence = {
      gpsLat: position?.lat ?? null,
      gpsLng: position?.lng ?? null,
      selfieDataUrl: selfieDataUrl!,
      cargoPhotoDataUrl: cargoPhotoDataUrl!,
      note: note.trim(),
      isDeviation,
      capturedAt: new Date().toISOString(),
      clientReportId,
      accuracyM: position?.accuracyM ?? null,
      phaseEventId: contextPhaseEventId(trip.phases) ?? undefined,
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
          body: 'Saved. Evidence stored on this device.',
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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
          <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold">Unable to verify trip</h1>
          <p className="text-lg leading-relaxed opacity-90">
            We could not confirm this checkpoint against your active trip.
            Go back to In Transit and try again.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => { markTransition('back'); router.replace(ROUTES.inTransit) }}>
          Back to In Transit
        </Button>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SubpageHeader
        title="Log Checkpoint"
        backLabel="In Transit"
        onBack={() => router.push(ROUTES.inTransit)}
      />
      <div className="flex flex-1 flex-col p-4">
        <p className="mb-6 text-body leading-relaxed text-surface-on-variant">
          Capture a selfie and a cargo photo to confirm your location and load mid-transit.
        </p>

        <div className="flex flex-col gap-6 mb-6">
          <CameraCapture label="Selfie" dataUrl={selfieDataUrl} onCapture={setSelfieDataUrl} />
          <CameraCapture label="Cargo photo" dataUrl={cargoPhotoDataUrl} onCapture={setCargoPhotoDataUrl} />

          {/* An iOS switch row, not a web checkbox (audit M5): a 16px square box read as a
              form from a website, and was the smallest target on the screen. The row is a
              grouped-list cell; the switch carries its own 44px hit area. */}
          <div className="flex min-h-[52px] items-center justify-between gap-4 rounded-2xl bg-surface-container-low pl-4 pr-2">
            <label htmlFor="route-deviation" className="text-body text-surface-on">
              This is a route deviation
            </label>
            <Switch id="route-deviation" checked={isDeviation} onCheckedChange={setIsDeviation} />
          </div>

          {/* "Optional" once, in the label — it used to appear three times (label-free
              placeholder, helper text and placeholder again). */}
          <TextArea
            label="Note (optional)"
            rows={3}
            placeholder="Anything dispatch should know"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {submitError && (
          // This branch only renders on a terminal 4xx — retrying with the same input
          // cannot succeed, so "check your connection" would be actively misleading here
          // (the connection worked; the server said no).
          <p className="mb-3 text-subhead text-error">
            Could not submit — the checkpoint was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
      </div>

      {/* The same pinned glass footer as the evidence steps (StepLayout). It also fixes a
          real bug: the swipe used to sit in a shrink-to-fit wrapper inside an
          items-center column, which gave its w-full track a width of 0px — the control
          rendered invisible and a checkpoint could not be submitted at all. A full-width
          block parent is what gives SwipeToConfirm its width. */}
      <footer className="glass-nav sticky bottom-0 z-sticky border-t border-outline-variant/25 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <RequirementChecklist
          requirements={[
            { label: 'Selfie', met: selfieDataUrl !== null },
            { label: 'Cargo photo', met: cargoPhotoDataUrl !== null },
          ]}
        />
        <div className="flex w-full justify-center">
          <SwipeToConfirm label={submitting ? 'Submitting…' : 'Swipe to Confirm'} onConfirm={handleSubmit} disabled={!isReady || submitting} />
        </div>
        <Button variant="secondary" size="md" className="mt-2 w-full" onClick={() => { markTransition('back'); router.push(ROUTES.inTransit) }}>
          Cancel
        </Button>
      </footer>
    </main>
  )
}
