'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue, type QueuedExceptionPhoto } from '@/lib/hooks/useOfflineQueue'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { ApiError } from '@/lib/api/client'
import { uploadArtifact } from '@/lib/api/artifacts'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { ExceptionType } from '@shared/lib/types/exception'
import type { Vehicle, VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'

// Options are derived from the shared DRIVER_EXCEPTION_TYPES so the picker can never
// drift to an invalid / non-driver type (e.g. system-detected gps_mismatch).
const EXCEPTION_LABELS: Partial<Record<ExceptionType, string>> = {
  delivery_refused:       'Delivery refused',
  cargo_damage:           'Cargo damage',
  seal_broken_in_transit: 'Seal broken in transit',
  mechanical:             'Vehicle breakdown',
  document_review:        'Document issue',
}

// panic_button has its own dedicated flow — exclude it from this picker.
const EXCEPTION_OPTIONS = DRIVER_EXCEPTION_TYPES
  .filter((value) => value !== 'panic_button')
  .map((value) => ({ value, label: EXCEPTION_LABELS[value] ?? value }))

// The one category that records WHICH vehicle it happened to (trailer analytics spec).
const BREAKDOWN_TYPE: ExceptionType = 'mechanical'

// Drivers call the horse "the truck", so the button says Truck while the code/API say horse.
const VEHICLE_LABELS: Record<VehicleType, string> = {
  horse: 'Truck',
  trailer: 'Trailer',
}
const VEHICLE_OPTIONS: readonly VehicleType[] = ['horse', 'trailer']

// The breakdown fields a report sends, in the wire's own names (RaiseExceptionBody).
interface BreakdownVehicleFields {
  vehicle_type?: VehicleType
  trailer_id?: string
}

/** Whether the "which vehicle" answer is complete, and what it sends. One function so
 * the submit gate and both request bodies can never disagree about the rules. */
function breakdownVehicle(
  type: ExceptionType | null,
  trailers: readonly Vehicle[],
  vehicleType: VehicleType | null,
  trailerId: VehicleId | null,
): { complete: boolean; fields: BreakdownVehicleFields } {
  if (type !== BREAKDOWN_TYPE) return { complete: true, fields: {} }
  if (trailers.length === 0 || vehicleType === 'horse') {
    return { complete: true, fields: { vehicle_type: 'horse' } }
  }
  if (vehicleType === 'trailer' && trailers.length === 1) {
    return { complete: true, fields: { vehicle_type: 'trailer' } }
  }
  if (vehicleType === 'trailer' && trailerId !== null) {
    return { complete: true, fields: { vehicle_type: 'trailer', trailer_id: String(trailerId) } }
  }
  return { complete: false, fields: {} }
}

interface OptionButtonProps {
  selected: boolean
  onClick: () => void
  children: ReactNode
}

// One style for every choice on this screen. aria-pressed tells a screen reader the state.
function OptionButton({ selected, onClick, children }: OptionButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
        selected
          ? 'border-secondary bg-secondary/10 text-secondary'
          : 'border-outline-variant bg-surface-container-lowest text-surface-on'
      }`}
    >
      {children}
    </button>
  )
}

// The photo upload gets its own label since it's the slow step on a bad signal.
type SubmitStage = 'idle' | 'uploading-photo' | 'saving'

export default function LogExceptionPageClient() {
  const router = useRouter()
  const { trip, logException } = useTrip()
  const { notify } = useToast()
  const { enqueueException } = useOfflineQueue()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<QueuedExceptionPhoto | null>(null)
  // Set once uploaded, so a retried submit references the existing artifact instead of
  // uploading the same image again.
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null)
  const [trailerId, setTrailerId] = useState<VehicleId | null>(null)

  const [stage, setStage] = useState<SubmitStage>('idle')
  // Two different failures that must not share one message: server refused the report,
  // versus it never got saved anywhere at all.
  const [submitError, setSubmitError] = useState<null | 'rejected' | 'not-saved'>(null)
  const submitting = stage !== 'idle'

  const handlePhotoCaptured = useCallback((dataUrl: string) => {
    // No eager upload, unlike the phase steps' useArtifactUpload: this photo is for an
    // optional form the driver can abandon freely. Upload begins in handleSubmit's Step 1.
    // Stamped at capture, not submit, since that's when the driver stood in front of it.
    const capturedAt = new Date().toISOString()
    setPhoto({ dataUrl, capturedAt })
    setArtifactId(null)
    setSubmitError(null)
  }, [])

  function chooseType(next: ExceptionType) {
    setType(next)
    // A new category resets the vehicle question so an old answer can't ride along.
    setVehicleType(null)
    setTrailerId(null)
  }

  function chooseVehicleType(next: VehicleType) {
    // A plate chosen under "Trailer" means nothing once the answer changes.
    if (next !== vehicleType) setTrailerId(null)
    setVehicleType(next)
  }

  async function handleSubmit() {
    if (!type || !trip || !description.trim()) return
    const vehicle = breakdownVehicle(type, trip.trailers, vehicleType, trailerId)
    if (!vehicle.complete) return
    setSubmitError(null)

    const tripId = String(trip.id)
    const clientReportId = crypto.randomUUID()
    // Captured now, not at flush time: the exception belongs to the leg being driven,
    // and by the time this entry sends the trip may have reached unloading.
    const phaseEventId = contextPhaseEventId(trip.phases)

    // Cleared once the photo is uploaded (only its id needs to go) or terminally rejected.
    let photoToQueue: QueuedExceptionPhoto | undefined = photo ?? undefined

    // The offline path, shared by a failed photo upload and a failed report submit.
    function queueForLater(supportingArtifactId: string | null): void {
      const result = enqueueException(
        tripId,
        {
          exception_type: type as ExceptionType,
          description,
          client_report_id: clientReportId,
          ...vehicle.fields,
          ...(supportingArtifactId ? { supporting_artifact_id: supportingArtifactId } : {}),
          ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
        },
        photoToQueue,
      )

      if (!result.persisted) {
        // Storage refused it outright — showing "Report saved" here would be a lie.
        setSubmitError('not-saved')
        return
      }

      // The body states exactly what is/isn't saved: "will sync later" alone would read
      // as a promise covering the photo too.
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
    // Already uploaded by an earlier attempt on this same photo: the queue only needs the id.
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
        const isTerminal = (
          err instanceof ApiError
          && err.status >= 400
          && err.status < 500
          && err.status !== 429
        )
        if (isTerminal) {
          // This image will be rejected the same way every time — continue without the
          // photo so the written report still reaches the dispatcher.
          notify({
            kind: 'error',
            title: 'Photo could not be attached',
            body: 'The report will be sent without it. Retake the photo and log a second report if the image matters.',
          })
          supportingArtifactId = null
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
        clientReportId,
        ...(vehicle.fields.vehicle_type ? { vehicleType: vehicle.fields.vehicle_type } : {}),
        ...(vehicle.fields.trailer_id ? { trailerId: vehicle.fields.trailer_id } : {}),
        ...(supportingArtifactId ? { supporting_artifact_id: supportingArtifactId } : {}),
      })
      // Names the chosen category as explicit proof the report registered.
      notify({
        kind: 'success',
        title: 'Exception recorded',
        body: `${EXCEPTION_LABELS[type] ?? type}${supportingArtifactId ? ' with photo' : ''}. Now listed under this trip's open exceptions.`,
      })
      router.push(ROUTES.inTransit)
    } catch (err) {
      console.error('Failed to log exception', err)
      // A 4xx fails identically on retry; a network failure or 5xx is retryable.
      const isRetryable = (
        !(err instanceof ApiError)
        || err.status === 0
        || err.status === 429
        || err.status >= 500
      )
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
          // Explicit replace, not router.back(): reachable via cold load/deep link, so
          // there may be no meaningful back-history.
          onClick={() => router.replace(ROUTES.inTransit)}
        >
          Return to in-transit
        </Button>
      </main>
    )
  }

  const trailers = trip.trailers
  const vehicleAnswer = breakdownVehicle(type, trailers, vehicleType, trailerId)
  // Asked only when there is a choice: a rigid truck has no trailer that could break down.
  const asksVehicle = type === BREAKDOWN_TYPE && trailers.length > 0
  // On an interlink, "Trailer" alone can't say which one.
  const asksPlate = asksVehicle && vehicleType === 'trailer' && trailers.length > 1

  return (
    <main className="flex min-h-dvh flex-col">
      <SubpageHeader
        title="Log Exception"
        backLabel="In-Transit Hub"
        onBack={() => router.push(ROUTES.inTransit)}
      />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-col gap-3 mb-6">
          {EXCEPTION_OPTIONS.map((opt) => (
            <OptionButton key={opt.value} selected={type === opt.value} onClick={() => chooseType(opt.value)}>
              {opt.label}
            </OptionButton>
          ))}
        </div>

        {asksVehicle && (
          <div role="group" aria-labelledby="breakdown-vehicle-question" className="flex flex-col gap-3 mb-6">
            <p id="breakdown-vehicle-question" className="text-sm font-medium text-surface-on">
              Which vehicle broke down?
            </p>
            {VEHICLE_OPTIONS.map((option) => (
              <OptionButton
                key={option}
                selected={vehicleType === option}
                onClick={() => chooseVehicleType(option)}
              >
                {VEHICLE_LABELS[option]}
              </OptionButton>
            ))}
          </div>
        )}

        {asksPlate && (
          <div role="group" aria-labelledby="breakdown-trailer-question" className="flex flex-col gap-3 mb-6">
            <p id="breakdown-trailer-question" className="text-sm font-medium text-surface-on">
              Which trailer? Check the registration plate.
            </p>
            {trailers.map((trailer) => (
              <OptionButton
                key={String(trailer.id)}
                selected={trailerId === trailer.id}
                onClick={() => setTrailerId(trailer.id)}
              >
                {trailer.registration}
              </OptionButton>
            ))}
          </div>
        )}

        <TextArea
          label="Description"
          helperText="Required"
          className="mb-6"
          rows={4}
          placeholder="Describe what happened"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />

        {/* The description is required evidence; the photograph remains optional. */}
        <div className="mb-6">
          <CameraCapture label="Photo (optional)" dataUrl={photo?.dataUrl ?? null} onCapture={handlePhotoCaptured} />
        </div>

        {submitError === 'rejected' && (
          // Terminal 4xx: retrying with the same input cannot succeed.
          <p className="mb-3 text-base text-error">
            Could not submit — the report was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
        {submitError === 'not-saved' && (
          // Send failed AND storage refused it — nothing is holding this report.
          <p className="mb-3 text-base text-error">
            Could not send or save this report — your device is out of storage. Free up
            space and try again, or report this to your dispatcher directly.
          </p>
        )}
        <Button
          size="lg"
          disabled={!type || !description.trim() || !vehicleAnswer.complete || submitting}
          onClick={handleSubmit}
        >
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
