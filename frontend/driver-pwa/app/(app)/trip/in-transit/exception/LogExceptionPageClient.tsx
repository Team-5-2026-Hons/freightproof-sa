'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, FileWarning, LockOpen, PackageX, TriangleAlert, Wrench, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue, type ExceptionDraft, type ExceptionSubmitOutcome } from '@/lib/hooks/useOfflineQueue'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { RequirementChecklist } from '@/components/phase/StepLayout'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import type { ExceptionType } from '@shared/lib/types/exception'
import type { Vehicle, VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'
import { MAX_EXCEPTION_PHOTOS } from '@shared/lib/constants/exception-evidence'
import { useLocation } from '@/lib/hooks/useLocation'
import { captureWithinBudget, REPORT_CAPTURE_BUDGET_MS } from '@/lib/utils/bounded-capture'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useBack } from '@/lib/navigation/useBack'
import { captureCustody } from '@/lib/session/custody-context'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'

const EXCEPTION_LABELS: Partial<Record<ExceptionType, string>> = {
  delivery_refused:       'Delivery refused',
  cargo_damage:           'Cargo damage',
  seal_broken_in_transit: 'Seal broken in transit',
  mechanical:             'Vehicle breakdown',
  document_review:        'Document issue',
}

const EXCEPTION_OPTIONS = DRIVER_EXCEPTION_TYPES
  .filter((value) => value !== 'panic_button')
  .map((value) => ({ value, label: EXCEPTION_LABELS[value] ?? value }))

const BREAKDOWN_TYPE: ExceptionType = 'mechanical'

const VEHICLE_LABELS: Record<VehicleType, string> = {
  horse: 'Truck',
  trailer: 'Trailer',
}
const VEHICLE_OPTIONS: readonly VehicleType[] = ['horse', 'trailer']

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

function Choice({ checked, onClick, children, className }: ChoiceProps) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick} className={className}>
      {children}
    </button>
  )
}

type SubmitStage = 'idle' | 'uploading-photo' | 'saving'

interface DraftPhoto {
  id: string
  dataUrl: string
  capturedAt: string
}

type SubmitError =
  | null
  | { kind: 'rejected' }
  | { kind: 'rejected-photo'; photoNumber: number }
  | { kind: 'not-saved'; photoCount: number }

function pluralPhotos(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`
}

export default function LogExceptionPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.inTransit)
  const largeText = useAccessibilityTextSize()
  const { trip, logException } = useTrip()
  const { notify } = useToast()
  const { submitExceptionReport } = useOfflineQueue()
  const { capture } = useLocation()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [choosingType, setChoosingType] = useState(true)
  const [description, setDescription] = useState('')
  const [clientReportId] = useState(() => crypto.randomUUID())
  const [photos, setPhotos] = useState<DraftPhoto[]>([])
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null)
  const [trailerId, setTrailerId] = useState<VehicleId | null>(null)

  const [stage, setStage] = useState<SubmitStage>('idle')
  const submitGuard = useRef(false)
  const [submitError, setSubmitError] = useState<SubmitError>(null)
  const submitting = stage !== 'idle'

  function addPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    setPhotos((current) => (
      current.length >= MAX_EXCEPTION_PHOTOS ? current : [...current, { id: crypto.randomUUID(), dataUrl, capturedAt }]
    ))
    setSubmitError(null)
  }

  function retakePhoto(photoId: string, dataUrl: string) {
    const capturedAt = new Date().toISOString()
    setPhotos((current) => current.map((p) => (p.id === photoId ? { id: crypto.randomUUID(), dataUrl, capturedAt } : p)))
    setSubmitError(null)
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => current.filter((p) => p.id !== photoId))
    setSubmitError(null)
  }

  function chooseType(next: ExceptionType) {
    setType(next)
    setChoosingType(false)
    setVehicleType(null)
    setTrailerId(null)
  }

  function chooseVehicleType(next: VehicleType) {
    if (next !== vehicleType) setTrailerId(null)
    setVehicleType(next)
  }

  async function handleSubmit() {
    if (!type || !trip || !description.trim()) return
    const vehicle = breakdownVehicle(type, trip.trailers, vehicleType, trailerId)
    if (!vehicle.complete) return
    if (submitGuard.current) return
    submitGuard.current = true
    try {
      await submitReport(type, trip, vehicle)
    } finally {
      submitGuard.current = false
    }
  }

  async function submitReport(
    type: ExceptionType,
    trip: NonNullable<ReturnType<typeof useTrip>['trip']>,
    vehicle: ReturnType<typeof breakdownVehicle>,
  ) {
    setSubmitError(null)

    const tripId = String(trip.id)
    const phaseEventId = contextPhaseEventId(trip.phases)
    const { custodySequence } = captureCustody(tripId)
    const location = await captureWithinBudget(capture, REPORT_CAPTURE_BUDGET_MS)
    const captureFields = location === null
      ? {}
      : {
          gpsLat: location.latitude,
          gpsLng: location.longitude,
          driverCapturedAt: location.capturedAt,
          driverAccuracyMetres: location.accuracy,
        }

    const draft: ExceptionDraft = {
      tripId,
      clientReportId,
      body: {
        exception_type: type,
        description,
        client_report_id: clientReportId,
        ...vehicle.fields,
        ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
        ...(custodySequence !== null ? { custody_sequence: custodySequence } : {}),
        ...(location
          ? {
              gps_lat: location.latitude,
              gps_lng: location.longitude,
              driver_captured_at: location.capturedAt,
              driver_accuracy_metres: location.accuracy,
            }
          : {}),
      },
      photos,
    }

    setStage(photos.length > 0 ? 'uploading-photo' : 'saving')
    try {
      const outcome = await submitExceptionReport(
        draft,
        (artifactIds) => logException(type, {
          description,
          clientReportId,
          ...captureFields,
          ...(custodySequence !== null ? { custodySequence } : {}),
          ...(vehicle.fields.vehicle_type ? { vehicleType: vehicle.fields.vehicle_type } : {}),
          ...(vehicle.fields.trailer_id ? { trailerId: vehicle.fields.trailer_id } : {}),
          ...(artifactIds.length > 0 ? { supporting_artifact_ids: artifactIds } : {}),
        }),
        (uploaded, total) => { if (uploaded >= total) setStage('saving') },
      )
      handleOutcome(outcome, type, photos.length)
    } finally {
      setStage('idle')
    }
  }

  function handleOutcome(outcome: ExceptionSubmitOutcome, category: ExceptionType, photoCount: number): void {
    switch (outcome.kind) {
      case 'acknowledged':
        notify({
          kind: 'success',
          title: 'Exception recorded',
          body: `${EXCEPTION_LABELS[category] ?? category}${photoCount > 0 ? ` with ${pluralPhotos(photoCount)}` : ''}. Now listed under this trip's open exceptions.`,
        })
        router.push(ROUTES.inTransit)
        return
      case 'saved-for-later':
        notify({
          kind: 'success',
          title: 'Report saved',
          body: photoCount > 0
            ? `Report and ${pluralPhotos(photoCount)} stored on this device. ${photoCount === 1 ? 'It syncs' : 'They sync'} when you’re back online.`
            : 'Stored on this device. It will sync when you’re back online.',
        })
        router.push(ROUTES.inTransit)
        return
      case 'not-saved':
        setSubmitError({ kind: 'not-saved', photoCount: outcome.photoCount })
        return
      case 'rejected':
        setSubmitError(
          outcome.photoIndex === null
            ? { kind: 'rejected' }
            : { kind: 'rejected-photo', photoNumber: outcome.photoIndex + 1 },
        )
        return
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
          onClick={() => { markTransition('back'); router.replace(ROUTES.inTransit) }}
        >
          Back to In Transit
        </Button>
      </main>
    )
  }

  const trailers = trip.trailers
  const vehicleAnswer = breakdownVehicle(type, trailers, vehicleType, trailerId)
  const asksVehicle = type === BREAKDOWN_TYPE && trailers.length > 0
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
        <div className="flex flex-col gap-1.5 px-5">
          <h2 className="text-title-1 tracking-tight text-surface-on">What happened?</h2>
          {choosingType && <p className="text-body text-surface-on-variant">Your dispatcher sees this straight away.</p>}
        </div>

        {choosingType || type === null ? (
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
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-title-3 text-surface-on">Photos (optional)</h3>
              {photos.length > 0 && (
                <span className="text-subhead text-surface-on-variant">{photos.length} of {MAX_EXCEPTION_PHOTOS}</span>
              )}
            </div>
            {photos.length > 0 && (
              <ol className="flex min-w-0 flex-col gap-3">
                {photos.map((photo, i) => (
                  <li key={photo.id} className="min-w-0">
                    <div role="group" aria-label={`Photo ${i + 1}`} className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <CameraCapture
                          variant="row"
                          label={`Photo ${i + 1}`}
                          capturedHint="Sends with the report"
                          dataUrl={photo.dataUrl}
                          onCapture={(dataUrl) => retakePhoto(photo.id, dataUrl)}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove photo ${i + 1}`}
                        onClick={() => removePhoto(photo.id)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-fill text-surface-on active:scale-95"
                      >
                        <X className="size-5" strokeWidth={1.9} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {photos.length < MAX_EXCEPTION_PHOTOS && (
              <CameraCapture
                variant="row"
                label={photos.length === 0 ? 'Add a photo' : 'Add another photo'}
                actionLabel={photos.length === 0 ? 'Add a photo' : 'Add another photo'}
                hint={photos.length === 0 ? 'Optional' : undefined}
                dataUrl={null}
                onCapture={addPhoto}
              />
            )}
          </div>
        </div>

        {submitError?.kind === 'rejected' && (
          <p role="alert" className="mt-4 px-5 text-subhead text-error">
            Could not submit. The report was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
        {submitError?.kind === 'rejected-photo' && (
          <p role="alert" className="mt-4 px-5 text-subhead text-error">
            Photo {submitError.photoNumber} was not accepted by the server. Remove or retake it, then submit again.
          </p>
        )}
        {submitError?.kind === 'not-saved' && (
          <p role="alert" className="mt-4 px-5 text-subhead text-error">
            Could not send this report and this device has no room to store it. Not saved: the
            description{submitError.photoCount > 0 ? ` and ${pluralPhotos(submitError.photoCount)}` : ''}.
            Nothing was lost from this screen. Free up space or get signal, then submit again.
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
        <Button size="pill" disabled={!ready} onClick={handleSubmit}>
          {stage === 'uploading-photo'
            ? 'Uploading Photos…'
            : stage === 'saving'
              ? 'Submitting…'
              : 'Submit Exception'}
        </Button>
      </footer>
    </main>
  )
}
