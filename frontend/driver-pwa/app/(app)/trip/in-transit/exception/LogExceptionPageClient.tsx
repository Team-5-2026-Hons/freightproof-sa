'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, FileWarning, LockOpen, PackageX, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { RequirementChecklist } from '@/components/phase/StepLayout'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { ExceptionType } from '@shared/lib/types/exception'
import type { Vehicle, VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'
import { useLocation } from '@/lib/hooks/useLocation'
import { captureWithinBudget, REPORT_CAPTURE_BUDGET_MS } from '@/lib/utils/bounded-capture'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useBack } from '@/lib/navigation/useBack'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'

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

const TYPE_ICONS: Partial<Record<ExceptionType, LucideIcon>> = {
  delivery_refused:       Ban,
  cargo_damage:           PackageX,
  seal_broken_in_transit: LockOpen,
  mechanical:             Wrench,
  document_review:        FileWarning,
}

function TypeDisc({ type, selected }: { type: ExceptionType; selected: boolean }) {
  const Icon = TYPE_ICONS[type] ?? TriangleAlert
  return (
    <span
      aria-hidden
      className={cn('flex size-10 items-center justify-center rounded-full', selected ? 'bg-surface-on text-surface' : 'bg-fill text-surface-on')}
    >
      <Icon className="size-5" strokeWidth={1.9} />
    </span>
  )
}

interface ChoiceProps {
  checked: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}

// Every choice on this screen is a radio: one answer per question, and a screen reader
// hears "radio, checked" rather than a toggle that could be pressed alongside others.
function Choice({ checked, onClick, children, className }: ChoiceProps) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick} className={className}>
      {children}
    </button>
  )
}

// The photo upload gets its own label since it's the slow step on a bad signal.
type SubmitStage = 'idle' | 'uploading-photo' | 'saving'

export default function LogExceptionPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.inTransit)
  // At accessibility text sizes the footer flows instead of pinning (see StepLayout).
  const largeText = useAccessibilityTextSize()
  const { trip, logException } = useTrip()
  const { notify } = useToast()
  const { enqueueException } = useOfflineQueue()
  const { capture } = useLocation()
  const [type, setType] = useState<ExceptionType | null>(null)
  // The category list collapses to the one chosen row (overhaul 6.4); Change reopens it.
  const [choosingType, setChoosingType] = useState(true)
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
    setChoosingType(false)
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
    // Optional enrichment, bounded: the report's own phone fix feeds the backend's
    // capture-time comparison, but a broken-seal report must not sit behind
    // useLocation's full 10 s geolocation timeout. Past REPORT_CAPTURE_BUDGET_MS the
    // report goes without a fix and its comparison simply reads "unverified".
    const location = await captureWithinBudget(capture, REPORT_CAPTURE_BUDGET_MS)
    const captureFields = location === null
      ? {}
      : {
          gpsLat: location.latitude,
          gpsLng: location.longitude,
          driverCapturedAt: location.capturedAt,
          driverAccuracyMetres: location.accuracy,
        }

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
          ...(location
            ? {
                gps_lat: location.latitude,
                gps_lng: location.longitude,
                driver_captured_at: location.capturedAt,
                driver_accuracy_metres: location.accuracy,
              }
            : {}),
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
        ...captureFields,
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
            Go back to In Transit and try again.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          // Explicit replace, not router.back(): reachable via cold load/deep link, so
          // there may be no meaningful back-history.
          onClick={() => { markTransition('back'); router.replace(ROUTES.inTransit) }}
        >
          Back to In Transit
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
  const ready = type !== null && description.trim() !== '' && vehicleAnswer.complete && !submitting

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <SubpageHeader
        title="Exception"
        backLabel="In Transit"
        titleVariant="bar"
        onBack={goBack}
      />
      <div className="flex flex-1 flex-col pb-6 pt-4">
        {/* h2: the header above already carries the screen's h1. */}
        <div className="flex flex-col gap-1.5 px-5">
          <h2 className="text-title-1 tracking-tight text-surface-on">What happened?</h2>
          {choosingType && <p className="text-body text-surface-on-variant">Your dispatcher sees this straight away.</p>}
        </div>

        {choosingType || type === null ? (
          // Named exactly as the footer chip names it, so the requirement points at
          // something on screen.
          <div role="radiogroup" aria-label="What happened" className="mt-3.5">
            {EXCEPTION_OPTIONS.map((opt, i) => {
              const checked = type === opt.value
              return (
                <div key={opt.value}>
                  {i > 0 && <div aria-hidden className="ml-[74px] h-px bg-hairline" />}
                  <Choice
                    checked={checked}
                    onClick={() => chooseType(opt.value)}
                    className="grid min-h-[60px] w-full grid-cols-[40px_minmax(0,1fr)_24px] items-center gap-x-3.5 px-5 py-2 text-left active:bg-fill"
                  >
                    <TypeDisc type={opt.value} selected={checked} />
                    <span className={cn('text-body text-surface-on', checked && 'font-semibold')}>{opt.label}</span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-[22px] items-center justify-center rounded-full',
                        checked ? 'bg-surface-on' : 'ring-2 ring-inset ring-outline-variant',
                      )}
                    >
                      {checked && <span className="size-2 rounded-full bg-surface" />}
                    </span>
                  </Choice>
                </div>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChoosingType(true)}
            aria-label={`Change what happened (now ${EXCEPTION_LABELS[type] ?? type})`}
            className="mx-4 mt-3.5 grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3.5 rounded-[18px] bg-fill px-3.5 py-2.5 text-left active:bg-surface-container-high"
          >
            <TypeDisc type={type} selected />
            <span className="break-words text-body font-semibold text-surface-on">{EXCEPTION_LABELS[type] ?? type}</span>
            <span className="text-subhead font-semibold text-surface-on">Change</span>
          </button>
        )}

        {asksVehicle && (
          <section className="mt-6 px-4">
            <h3 id="breakdown-vehicle-question" className="px-1 text-title-3 text-surface-on">Which vehicle broke down?</h3>
            {/* A segmented control: two answers, side by side, the chosen one raised. */}
            <div role="radiogroup" aria-labelledby="breakdown-vehicle-question" className="mt-2.5 grid grid-cols-2 gap-1 rounded-2xl bg-fill p-1">
              {VEHICLE_OPTIONS.map((option) => (
                <Choice
                  key={option}
                  checked={vehicleType === option}
                  onClick={() => chooseVehicleType(option)}
                  className={cn(
                    'h-12 rounded-xl text-body font-semibold transition-colors',
                    vehicleType === option ? 'bg-surface text-surface-on shadow-ambient-sm' : 'text-surface-on-variant',
                  )}
                >
                  {VEHICLE_LABELS[option]}
                </Choice>
              ))}
            </div>
          </section>
        )}

        {asksPlate && (
          <section className="mt-6 px-4">
            <h3 id="breakdown-trailer-question" className="px-1 text-title-3 text-surface-on">Which trailer?</h3>
            <p className="mb-3 px-1 text-subhead text-surface-on-variant">Check the registration plate on the trailer.</p>
            {/* Each trailer drawn as its number plate — the thing the driver walks back
                and reads off the trailer itself. */}
            <div role="radiogroup" aria-labelledby="breakdown-trailer-question" className="grid grid-cols-2 gap-2.5">
              {trailers.map((trailer) => {
                const checked = trailerId === trailer.id
                return (
                  <Choice
                    key={String(trailer.id)}
                    checked={checked}
                    onClick={() => setTrailerId(trailer.id)}
                    className={cn(
                      'flex h-[76px] items-center justify-center rounded-2xl',
                      checked ? 'bg-surface ring-[2.5px] ring-inset ring-surface-on' : 'bg-fill',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-[38px] items-center rounded-md bg-white px-3 text-body font-extrabold tracking-wider text-black ring-2 ring-inset',
                        checked ? 'ring-black' : 'ring-neutral-300',
                      )}
                    >
                      {trailer.registration}
                    </span>
                  </Choice>
                )
              })}
            </div>
          </section>
        )}

        <div className="mt-6 flex flex-col gap-3 px-5">
          <TextArea
            label="Describe what happened"
            rows={3}
            placeholder="e.g. Pallet 3 crushed, top boxes wet"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          {/* The description is required evidence; the photograph stays optional, so it is
              one compact row rather than a tile that would bury the submit. */}
          <CameraCapture
            variant="row"
            label="Photo (optional)"
            actionLabel="Add a photo"
            hint="Optional"
            capturedHint="Sends with the report"
            dataUrl={photo?.dataUrl ?? null}
            onCapture={handlePhotoCaptured}
          />
        </div>

        {submitError === 'rejected' && (
          // Terminal 4xx: retrying with the same input cannot succeed.
          <p className="mt-4 px-5 text-subhead text-error">
            Could not submit — the report was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
        {submitError === 'not-saved' && (
          // Send failed AND storage refused it — nothing is holding this report.
          <p className="mt-4 px-5 text-subhead text-error">
            Could not send or save this report — your device is out of storage. Free up
            space and try again, or report this to your dispatcher directly.
          </p>
        )}
      </div>

      <footer className={cn('glass-nav border-t border-hairline px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]', !largeText && 'sticky bottom-0 z-sticky')}>
        <RequirementChecklist
          requirements={[
            { label: 'What happened', met: type !== null },
            ...(asksVehicle ? [{ label: 'Which vehicle', met: vehicleAnswer.complete }] : []),
            { label: 'Description', met: description.trim() !== '' },
          ]}
        />
        {/* A button, not a swipe: a report is not a ledger phase, and in a breakdown or a
            refusal speed matters more than the guard against a stray tap. The label stays
            "Submit Exception" while waiting — the chips above say what is missing. */}
        <Button size="pill" disabled={!ready} onClick={handleSubmit}>
          {stage === 'uploading-photo'
            ? 'Uploading Photo…'
            : stage === 'saving'
              ? 'Submitting…'
              : 'Submit Exception'}
        </Button>
      </footer>
    </main>
  )
}
