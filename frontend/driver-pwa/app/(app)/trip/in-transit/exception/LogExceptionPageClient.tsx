// frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx
'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue, type QueuedExceptionPhoto } from '@/lib/hooks/useOfflineQueue'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { ApiError } from '@/lib/api/client'
import { uploadArtifact } from '@/lib/api/artifacts'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { ExceptionType } from '@shared/lib/types/exception'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'

// Labels for the driver-selectable exceptions. Options are DERIVED from the shared
// DRIVER_EXCEPTION_TYPES so the picker can never drift to an invalid / non-driver type
// (e.g. system-detected gps_mismatch or route_deviation). The backend remains the
// authority on what each exception means and whether it is valid.
const EXCEPTION_LABELS: Partial<Record<ExceptionType, string>> = {
  delivery_refused:       'Delivery refused',
  cargo_damage:           'Cargo damage',
  seal_broken_in_transit: 'Seal broken in transit',
  mechanical:             'Vehicle breakdown',
  document_review:        'Document issue',
}

// panic_button has its own dedicated flow (Task 13) — exclude it from this picker.
const EXCEPTION_OPTIONS = DRIVER_EXCEPTION_TYPES
  .filter((value) => value !== 'panic_button')
  .map((value) => ({ value, label: EXCEPTION_LABELS[value] ?? value }))

// What the submit button is currently doing. The photo upload gets its own label because
// it is the slow step on a bad signal — a driver watching "Submitting…" for thirty
// seconds has no way to tell a large upload from a hung one.
type SubmitStage = 'idle' | 'uploading-photo' | 'saving'

export default function LogExceptionPageClient() {
  const router = useRouter()
  const { trip, logException } = useTrip()
  const { notify } = useToast()
  const { enqueueException } = useOfflineQueue()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<QueuedExceptionPhoto | null>(null)
  // Set once the photo is safely uploaded, so a retried submit references the existing
  // artifact instead of uploading the same image a second time.
  const [artifactId, setArtifactId] = useState<string | null>(null)

  const [stage, setStage] = useState<SubmitStage>('idle')
  // Two genuinely different failures that must not share one message: the server
  // refused the report, versus the report never got saved anywhere at all.
  const [submitError, setSubmitError] = useState<null | 'rejected' | 'not-saved'>(null)
  const submitting = stage !== 'idle'

  // Hooks must run before the no-trip guard below returns, so this tolerates a null trip;
  // uploadNow is never reached without one.
  const { uploadNow } = useArtifactUpload(trip ? String(trip.id) : '')

  // Identifies the photo currently on screen. A slow upload of a since-retaken photo must
  // not resolve and attach the wrong image's id to the report.
  const latestCaptureRef = useRef<string | null>(null)

  const handlePhotoCaptured = useCallback(
    (dataUrl: string) => {
      // Stamped at capture, not at submit: this is when the driver stood in front of the
      // problem, which is the time the evidence trail should carry.
      const capturedAt = new Date().toISOString()
      latestCaptureRef.current = capturedAt
      setPhoto({ dataUrl, capturedAt })
      setArtifactId(null)
      setSubmitError(null)

      // Start uploading while the driver types the description, the same trade the phase
      // steps make. Deliberately fire-and-forget — submit re-uploads if this doesn't
      // land, and the queue carries the data URL if that fails too, so there is no
      // outcome here the driver needs to see or act on.
      void uploadNow(dataUrl, 'photo', capturedAt).then((id) => {
        if (id && latestCaptureRef.current === capturedAt) setArtifactId(id)
      })
    },
    [uploadNow],
  )

  async function handleSubmit() {
    if (!type || !trip) return
    setSubmitError(null)

    const tripId = String(trip.id)
    // Captured now, not at flush time — see PanicPageClient for the full reasoning.
    // A breakdown or a seal found broken on the road belongs to the leg being
    // driven, and by the time this entry sends the trip may have reached unloading.
    const phaseEventId = contextPhaseEventId(trip.phases)

    // The image still needing to travel with the queued entry. Cleared once the photo is
    // uploaded (only its id needs to go) or once the server has terminally rejected it
    // (re-queuing guarantees the same rejection at flush).
    let photoToQueue: QueuedExceptionPhoto | undefined = photo ?? undefined

    // The offline path, shared by a failed photo upload and a failed report submit.
    function queueForLater(supportingArtifactId: string | null): void {
      const result = enqueueException(
        tripId,
        {
          exception_type: type as ExceptionType,
          description,
          ...(supportingArtifactId ? { supporting_artifact_id: supportingArtifactId } : {}),
          ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
        },
        photoToQueue,
      )

      if (!result.persisted) {
        // Storage refused it outright, so nothing will ever be sent. Showing the usual
        // "Report saved" receipt here would be a lie about evidence.
        setSubmitError('not-saved')
        return
      }

      // Receipt parity with CheckpointPageClient's identical queue path: without a
      // toast the driver lands back on the hub with zero evidence the report
      // registered anywhere — indistinguishable from a silent failure. The body states
      // exactly what is and isn't saved, because "will sync later" otherwise reads as a
      // promise covering the photo too.
      const photoDropped = photoToQueue !== undefined && !result.photoPersisted
      notify({
        kind: photoDropped ? 'error' : 'success',
        title: 'Report saved',
        body: photoDropped
          ? 'Stored on this device and will sync when you’re back online — but there was no room to store the photo. Photograph it again once you have signal.'
          : photoToQueue
            ? 'Report and photo stored on this device. Both sync when you’re back online.'
            : supportingArtifactId
              ? 'Stored on this device. Your photo is already uploaded; the report syncs when you’re back online.'
              : 'Stored on this device. It will sync when you’re back online.',
      })
      router.push(ROUTES.inTransit)
    }

    // ── Step 1: make sure the photo exists server-side before the report cites it ──
    let supportingArtifactId = artifactId
    // Already uploaded (by the eager upload at capture): the bytes are on the server, so
    // the queue only ever needs to carry the id.
    if (supportingArtifactId) photoToQueue = undefined
    if (photo && !supportingArtifactId) {
      setStage('uploading-photo')
      try {
        const artifact = await uploadArtifact({
          tripId,
          artifactType: 'photo',
          dataUrl: photo.dataUrl,
          capturedAt: photo.capturedAt,
        })
        supportingArtifactId = artifact.id
        setArtifactId(artifact.id)
        photoToQueue = undefined
      } catch (err) {
        console.error('Failed to upload the exception photo', err)
        const isTerminal = err instanceof ApiError && err.status >= 400 && err.status < 500
        if (isTerminal) {
          // This image will be rejected the same way every time (too large, unsupported
          // format). Same policy as the queue's own sendException: the written report is
          // the part that must reach the dispatcher, so continue without the photo and
          // say so plainly rather than dead-ending the driver on an unfixable error.
          notify({
            kind: 'error',
            title: 'Photo could not be attached',
            body: 'The report will be sent without it. Retake the photo and log a second report if the image matters.',
          })
          supportingArtifactId = null
          // Do not queue it either: the same bytes would be rejected the same way.
          photoToQueue = undefined
        } else {
          // Transient: queue the report with the image still attached.
          setStage('idle')
          queueForLater(null)
          return
        }
      }
    }

    // ── Step 2: raise the exception ──
    setStage('saving')
    try {
      await logException(type, {
        description,
        ...(supportingArtifactId ? { supporting_artifact_id: supportingArtifactId } : {}),
      })
      // Receipt (UX Task 5b): name the chosen category so the driver has explicit proof
      // the report registered before landing back on the hub, where it now also appears
      // in the open-exceptions list (TripContext appends it on logException).
      notify({
        kind: 'success',
        title: 'Exception recorded',
        body: `${EXCEPTION_LABELS[type] ?? type}${supportingArtifactId ? ' with photo' : ''}. Now listed under this trip's open exceptions.`,
      })
      router.push(ROUTES.inTransit)
    } catch (err) {
      console.error('Failed to log exception', err)
      // A 4xx (e.g. wrong driver, validation) will fail identically on retry — show the
      // error and let the driver fix/retry manually. A network failure or 5xx is
      // retryable, so queue it and let the driver move on; it syncs on reconnect.
      const isRetryable = !(err instanceof ApiError) || err.status >= 500
      if (isRetryable) {
        queueForLater(supportingArtifactId)
      } else {
        setSubmitError('rejected')
      }
    } finally {
      setStage('idle')
    }
  }

  if (!trip) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
          <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold">Unable to verify trip</h1>
          <p className="text-lg leading-relaxed opacity-90">
            We could not confirm this exception against your active trip.
            Return to in-transit and try again.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          // This state is reachable via cold load, deep link, or refresh —
          // there may be no meaningful back-history, so router.back() could
          // land anywhere (or nowhere). Use an explicit replace so the label's
          // promise ("Return to in-transit") is actually guaranteed.
          onClick={() => router.replace(ROUTES.inTransit)}
        >
          Return to in-transit
        </Button>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col">
      {/* Named destination (not router.back()): guarantees where the driver lands
          regardless of history, matching the hub's own back-link pattern. */}
      <SubpageHeader
        title="Log Exception"
        backLabel="In-Transit Hub"
        onBack={() => router.push(ROUTES.inTransit)}
      />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-col gap-3 mb-6">
          {EXCEPTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                type === opt.value
                  ? 'border-secondary bg-secondary/10 text-secondary'
                  : 'border-outline-variant bg-surface-container-lowest text-surface-on'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <TextArea
          label="Description"
          helperText="Optional"
          className="mb-6"
          rows={4}
          placeholder="Describe what happened (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Photo and description sit side by side on purpose: a driver reporting damage
            usually needs both, and neither is required to file the report. */}
        <div className="mb-6">
          <CameraCapture label="Photo (optional)" dataUrl={photo?.dataUrl ?? null} onCapture={handlePhotoCaptured} />
        </div>

        {submitError === 'rejected' && (
          // A terminal 4xx — retrying with the same input cannot succeed, so "check your
          // connection" would be actively misleading here (the connection worked; the
          // server said no).
          <p className="mb-3 text-base text-error">
            Could not submit — the report was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
        {submitError === 'not-saved' && (
          // The send failed AND the device refused to store it for later, so unlike every
          // other failure on this screen there is nothing holding this report. Say so:
          // the driver needs to know to radio it in rather than assume it is queued.
          <p className="mb-3 text-base text-error">
            Could not send or save this report — your device is out of storage. Free up
            space and try again, or report this to your dispatcher directly.
          </p>
        )}
        <Button size="lg" disabled={!type || submitting} onClick={handleSubmit}>
          {/* Named stages, not one spinner: the upload is the slow step on a weak signal,
              and the API client uses fetch, which cannot report real upload progress —
              so this says which step is running rather than implying a percentage. */}
          {stage === 'uploading-photo'
            ? 'Uploading photo…'
            : stage === 'saving'
              ? 'Submitting…'
              : 'Submit exception'}
        </Button>
      </div>
    </main>
  )
}
