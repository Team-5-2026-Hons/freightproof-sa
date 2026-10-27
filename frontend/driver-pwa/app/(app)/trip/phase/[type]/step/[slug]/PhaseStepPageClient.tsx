// The URL keys on phase_type (see page.tsx and lib/phase/routes.ts's header note) — the
// actual phase_event_id a driver is addressing is resolved here, client-side, from
// TripContext via actionablePhase(trip.phases). A cross-dock plan can visit `unloading`
// (say) more than once; the URL alone can never disambiguate which occurrence, only the
// ledger can — which is exactly why the guard below redirects on any mismatch instead of
// trusting the URL's [type] segment at face value.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import { usePhaseDraft } from '@/lib/hooks/usePhaseDraft'
import { useVisualCountCarry } from '@/lib/hooks/useVisualCountCarry'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocation } from '@/lib/hooks/useLocation'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import {
  startPhaseSubmission, usePhaseSubmissions, type PhaseSubmissionOutcome,
} from '@/lib/submission/phase-submitter'
import { actionablePhase, stepsFor, nextStepRoute, currentStepRoute, isAnchored, isFinalPhase } from '@/lib/phase'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Button } from '@/components/ui/Button'
import { HoldNotice } from '@/components/trip/HoldNotice'
import { recordedPlace } from '@/lib/phase/recorded-place'
import { stepComponentFor } from '@/components/phase/steps/registry'
import { fetchLinehaul } from '@/lib/api/manifest'
import { previewPhaseLocation } from '@/lib/api/phases'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { Linehaul as LinehaulDocument } from '@shared/lib/types/manifest'
import type {
  ActivationEvidence, LoadingEvidence, DepartureEvidence, ArrivalEvidence, UnloadingEvidence,
  ConfirmationEvidence, PhaseEvidence,
} from '@/lib/types/evidence-draft'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import { LocationCheckModal } from '@/components/phase/LocationCheckModal'
import { actorGeneration, captureCustody } from '@/lib/session/custody-context'

const ACTIVATION_INITIAL: ActivationEvidence = { capturedAt: null }
const LOADING_INITIAL: LoadingEvidence = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null,
  linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt: null,
}
const DEPARTURE_INITIAL: DepartureEvidence = {
  sealNumber: null, sealNumberOcr: null, sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
const UNLOADING_INITIAL: UnloadingEvidence = {
  waybillHandedOver: null, driverVisualCount: null, capturedAt: null,
}
const ARRIVAL_INITIAL: ArrivalEvidence = {
  sealCondition: null, sealNumberAtArrival: null, sealNumberAtArrivalOcr: null,
  sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
const CONFIRMATION_INITIAL_BASE: Omit<ConfirmationEvidence, 'driverVisualCount'> = {
  podPhotoDataUrl: null, podPhotoArtifactId: null,
  podSignatureArtifactId: null, receiverConfirmedAt: null,
  reconciliationNote: null, capturedAt: null,
}

function renderStep<P extends object>(Component: ComponentType<never>, props: P) {
  const Widened = Component as unknown as ComponentType<P>
  return <Widened {...props} />
}

function UnknownStep({ phaseType, slug }: { phaseType: PhaseType; slug: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <p className="text-sm text-error">Unknown step: {phaseType}/{slug}</p>
    </main>
  )
}

export default function PhaseStepPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  const [isHandingOff, setIsHandingOff] = useState(false)
  const { inFlight } = usePhaseSubmissions()
  const isSubmitting = isHandingOff || inFlight.length > 0

  const lastTripRef = useRef<Trip | null>(null)
  useEffect(() => {
    if (trip) lastTripRef.current = trip
  }, [trip])

  const handedOffTripRef = useRef<Trip | null>(null)
  const beginHandOff = useCallback(() => {
    handedOffTripRef.current = lastTripRef.current
    setIsHandingOff(true)
  }, [])

  const activeTrip = (isHandingOff ? handedOffTripRef.current : null)
    ?? trip
    ?? (isSubmitting ? lastTripRef.current : null)

  if (activeTrip === null) {
    if (isLoading) return <LoadingScreen label="Loading trip" />
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  if (activeTrip.status === 'exception_hold') {
    return (
      <main className="flex min-h-dvh flex-col justify-center gap-4 bg-surface p-5">
        <HoldNotice />
        <Button variant="fill" size="pill" onClick={() => router.push(ROUTES.activeTripDetail)}>
          View Trip
        </Button>
      </main>
    )
  }

  return <PhaseStepContent trip={activeTrip} onHandOff={beginHandOff} />
}

interface PhaseStepContentProps {
  trip: Trip
  onHandOff: () => void
}

function PhaseStepContent({ trip, onHandOff }: PhaseStepContentProps) {
  const { type, slug } = useParams<{ type: string; slug: string }>()
  const router = useRouter()

  const urlPhaseType = type as PhaseType

  const phase = actionablePhase(trip.phases)
  const steps = phase !== null ? stepsFor(phase) : []
  const mismatched = phase === null || phase.phase_type !== urlPhaseType

  useEffect(() => {
    if (mismatched) router.replace(currentStepRoute(trip.phases))
  }, [mismatched, trip.phases, router])

  if (phase === null || mismatched) {
    return <LoadingScreen label="Loading step" />
  }

  const stepIndex = steps.findIndex((s) => s.slug === slug)
  if (stepIndex === -1) {
    return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  }

  const custody = captureCustody(String(trip.id))
  return (
    <PhaseStepRouter
      key={`${phase.phase_event_id}:${actorGeneration()}:${custody.actorId}:${custody.custodySequence}`}
      trip={trip}
      phase={phase}
      slug={slug}
      stepIndex={stepIndex}
      isFinalStep={stepIndex === steps.length - 1}
      onHandOff={onHandOff}
    />
  )
}

interface StepControllerProps {
  trip: Trip
  phase: PhaseDescriptor
  slug: string
  stepIndex: number
  isFinalStep: boolean
  onHandOff: () => void
}

function PhaseStepRouter(props: StepControllerProps) {
  switch (props.phase.phase_type) {
    case 'activation': return <ActivationStep {...props} />
    case 'loading': return <LoadingStep {...props} />
    case 'departure': return <DepartureStep {...props} />
    case 'arrival': return <ArrivalStep {...props} />
    case 'unloading': return <UnloadingStep {...props} />
    case 'confirmation': return <ConfirmationStep {...props} />
    case 'trip_creation':
    case 'in_transit':
      return null
    default: {
      const unreachable: never = props.phase.phase_type
      throw new Error(`PhaseStepRouter: unhandled phase type "${String(unreachable)}"`)
    }
  }
}

type RecordedNotice = 'anchored' | 'anchoring' | 'plain'

function usePhaseStepController<T extends PhaseEvidence>(
  trip: Trip,
  phase: PhaseDescriptor,
  slug: string,
  isFinalStep: boolean,
  initial: T,
  onHandOff: () => void,
  onResolved: (freshTrip: Trip | null, evidence: T) => void,
): {
  draft: T
  onUpdate: (patch: Partial<T>) => void
  onComplete: () => void | Promise<void>
  locationCheckModal: ReactNode
} {
  const router = useRouter()
  const { notify } = useToast()
  const { enqueuePhase } = useOfflineQueue()
  const { refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing, noteTripHandedOver, noteTripCompleted } = useTrip()
  const { capture } = useLocation()
  const tripId = String(trip.id)
  const captureScope = useRef({ ...captureCustody(tripId), generation: actorGeneration() })
  function isCurrentCapture(): boolean {
    const live = captureCustody(tripId)
    const original = captureScope.current
    return actorGeneration() === original.generation && live.actorId === original.actorId
      && live.custodySequence === original.custodySequence
  }

  const [draft, updateDraftRaw, clearDraft] = usePhaseDraft<T>(tripId, phase.phase_event_id, initial)
  const [locationAssessment, setLocationAssessment] = useState<ActionLocationAssessment | null>(null)
  const [locationPreviewLoading, setLocationPreviewLoading] = useState(false)
  const [locationPreviewError, setLocationPreviewError] = useState<string | null>(null)
  const [pendingPosition, setPendingPosition] = useState<DriverPosition | null>(null)
  const [pendingCapturedAt, setPendingCapturedAt] = useState<string | null>(null)
  const [offlineLocationCheck, setOfflineLocationCheck] = useState(false)

  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  function onUpdate(patch: Partial<T>) {
    if (!isCurrentCapture()) return
    draftRef.current = { ...draftRef.current, ...patch }
    updateDraftRaw(patch)
  }

  const idempotencyKeyRef = useRef<string | null>(null)

  function recordedNotice(addressedPhase: PhaseDescriptor | null): RecordedNotice {
    if (IS_DEMO_MODE || !isAnchored(phase)) return 'plain'
    return addressedPhase?.blockchain_receipt_id ? 'anchored' : 'anchoring'
  }

  function notifyPhaseRecorded(notice: RecordedNotice) {
    const savedAt = formatTime(new Date())
    if (notice === 'plain') {
      notify({ kind: 'success', title: `${PHASE_NAMES[phase.phase_type]} recorded`, body: `${savedAt} · Stored on this device` })
      return
    }
    const place = recordedPlace(trip, phase)
    notify({
      kind: 'success',
      title: `${PHASE_NAMES[phase.phase_type]} recorded`,
      body: place === null ? savedAt : `${savedAt} · ${place}`,
      anchor: notice,
    })
  }

  function notifyTripOnHold() {
    notify({
      kind: 'error',
      title: 'Trip on hold',
      body: 'A critical exception was recorded. The trip is paused for dispatcher review.',
    })
  }

  function notifyStaleCapture(): void {
    notify({ kind: 'error', title: 'Could not continue', body: 'Account changed; captured work is retained.' })
  }

  function notifyFinalLocationWarning(addressedPhase: PhaseDescriptor | null): void {
    const assessment = addressedPhase?.action_location_assessment
    const hasReliableWarning = assessment !== null && assessment !== undefined && (
      (assessment.proximity === 'separated' && assessment.separation_metres !== null)
      || assessment.truck_in_precinct === false
      || assessment.driver_in_precinct === false
    )
    if (!hasReliableWarning) return
    notify({
      kind: 'error',
      title: 'Location warning recorded',
      body: 'The final location check found a discrepancy. Your action was still recorded for review.',
    })
  }

  function advanceWithinPhase() {
    router.push(nextStepRoute(trip.phases, phase, slug))
  }

  function handleOutcome(outcome: PhaseSubmissionOutcome, evidence: T) {
    if (!isCurrentCapture()) return
    switch (outcome.kind) {
      case 'recorded': {
        onResolved(outcome.trip, evidence)
        clearDraft(evidence)
        if (outcome.trip !== null) {
          adoptTrip(outcome.trip)
          clearPhaseSyncing(phase.phase_event_id)
        }
        notifyPhaseRecorded(recordedNotice(outcome.addressedPhase))
        notifyFinalLocationWarning(outcome.addressedPhase)
        return
      }
      case 'hold': {
        onResolved(outcome.trip, evidence)
        clearDraft(evidence)
        adoptTrip(outcome.trip)
        clearPhaseSyncing(phase.phase_event_id)
        notifyTripOnHold()
        router.push(ROUTES.activeTripDetail)
        return
      }
      case 'queued': {
        onResolved(null, evidence)
        notifyPhaseRecorded('plain')
        return
      }
      case 'conflict':
      case 'failed': {
        clearPhaseSyncing(phase.phase_event_id)
        notify({
          kind: 'error',
          title: outcome.kind === 'conflict' ? 'Could not confirm phase' : 'Could not submit',
          body: outcome.message,
        })
        return
      }
      case 'retained': {
        clearPhaseSyncing(phase.phase_event_id)
        if (outcome.persisted) clearDraft(evidence)
        notify({ kind: 'error', title: 'Not recorded on the trip', body: outcome.message })
        if (outcome.handedOver) noteTripHandedOver(tripId)
        return
      }
      default: {
        const unreachable: never = outcome
        throw new Error(`handleOutcome: unhandled outcome "${String(unreachable)}"`)
      }
    }
  }

  function handOffSubmission(
    position: DriverPosition | null,
    driverCapturedAt: string,
    acknowledgement: LocationWarningAcknowledgement | null,
  ) {
    if (!isCurrentCapture()) { notifyStaleCapture(); return }
    onHandOff()
    if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = crypto.randomUUID()
    const evidence = draftRef.current
    startPhaseSubmission({
      tripId,
      phaseEventId: phase.phase_event_id,
      phaseType: phase.phase_type,
      evidence,
      idempotencyKey: idempotencyKeyRef.current,
      driverCapturedAt,
      position: Promise.resolve(position),
      acknowledgement,
      custody: { actorId: captureScope.current.actorId, custodySequence: captureScope.current.custodySequence },
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleOutcome(outcome, evidence),
    })

    markPhaseSyncing(phase.phase_event_id)

    if (isFinalPhase(trip.phases, phase)) {
      noteTripCompleted({
        tripId,
        tripReference: trip.trip_reference,
        phases: trip.phases.map(row => row.phase_event_id === phase.phase_event_id
          ? { ...row, status: 'completed' as const, completed_at: driverCapturedAt }
          : row),
      })
    }

    router.push(phase.phase_type === 'departure' ? ROUTES.inTransit : ROUTES.home)
  }

  async function startLocationCheck(): Promise<void> {
    if (locationPreviewLoading) return
    if (!isCurrentCapture()) { notifyStaleCapture(); return }
    const attemptStartedAt = new Date().toISOString()
    setLocationPreviewLoading(true)
    setLocationPreviewError(null)
    setLocationAssessment(null)
    setPendingPosition(null)
    setPendingCapturedAt(null)

    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    setOfflineLocationCheck(offline)
    const coords = await capture()
    if (!isCurrentCapture()) { notifyStaleCapture(); return }
    if (coords === null) {
      setPendingCapturedAt(attemptStartedAt)
      setLocationPreviewLoading(false)
      return
    }

    const position: DriverPosition = {
      lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy, capturedAt: coords.capturedAt,
    }
    setPendingPosition(position)
    setPendingCapturedAt(coords.capturedAt)
    if (offline) {
      setLocationPreviewLoading(false)
      return
    }
    try {
      const assessment = await previewPhaseLocation(tripId, phase.phase_event_id, {
        lat: position.lat,
        lng: position.lng,
        accuracy_metres: position.accuracyM,
        captured_at: coords.capturedAt,
      })
      if (!isCurrentCapture()) { notifyStaleCapture(); return }
      const requiresAcknowledgement =
        (assessment.proximity === 'separated' && assessment.separation_metres !== null)
        || assessment.truck_in_precinct === false
        || assessment.driver_in_precinct === false
      if (requiresAcknowledgement || assessment.proximity === 'unverified') {
        setLocationAssessment(assessment)
      } else {
        setPendingCapturedAt(null)
        setPendingPosition(null)
        handOffSubmission(position, coords.capturedAt, null)
      }
    } catch (err) {
      if (!isCurrentCapture()) { notifyStaleCapture(); return }
      console.error('PhaseStepPageClient: location preview failed', err)
      setLocationPreviewError('Location preview failed')
    } finally {
      if (isCurrentCapture()) setLocationPreviewLoading(false)
    }
  }

  function continueAfterLocationCheck(reason: string | null): void {
    const capturedAt = pendingCapturedAt ?? new Date().toISOString()
    const acknowledgement = reason === null
      ? null
      : { acknowledgedAt: new Date().toISOString(), reason }
    handOffSubmission(pendingPosition, capturedAt, acknowledgement)
  }

  const onComplete = isFinalStep ? () => { void startLocationCheck() } : advanceWithinPhase
  const showLocationCheck = isFinalStep && (locationPreviewLoading || pendingCapturedAt !== null)
  const locationCheckModal = isFinalStep ? (
    <LocationCheckModal
      open={showLocationCheck}
      assessment={locationAssessment}
      loading={locationPreviewLoading}
      error={locationPreviewError}
      offline={offlineLocationCheck}
      onRetry={() => { void startLocationCheck() }}
      onContinue={continueAfterLocationCheck}
    />
  ) : null

  return { draft, onUpdate, onComplete, locationCheckModal }
}

function ActivationStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<ActivationEvidence>(
    trip, phase, slug, isFinalStep, ACTIVATION_INITIAL, onHandOff, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })}{locationCheckModal}</>
}

export function LoadingStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<LoadingEvidence>(
    trip, phase, slug, isFinalStep, LOADING_INITIAL, onHandOff, () => {},
  )

  const [linehaul, setLinehaul] = useState<LinehaulDocument | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchLinehaul(tripId)
      .then((doc) => { if (!cancelled) setLinehaul(doc) })
      .catch(() => { if (!cancelled) setLinehaul(null) })
    return () => { cancelled = true }
  }, [tripId])

  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete, linehaul })}{locationCheckModal}</>
}

function DepartureStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<DepartureEvidence>(
    trip, phase, slug, isFinalStep, DEPARTURE_INITIAL, onHandOff, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })}{locationCheckModal}</>
}

function ArrivalStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<ArrivalEvidence>(
    trip, phase, slug, isFinalStep, ARRIVAL_INITIAL, onHandOff, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })}{locationCheckModal}</>
}

function UnloadingStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const [, setVisualCountCarry] = useVisualCountCarry(tripId)
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<UnloadingEvidence>(
    trip, phase, slug, isFinalStep, UNLOADING_INITIAL, onHandOff,
    (_freshTrip, evidence) => setVisualCountCarry(evidence.driverVisualCount),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })}{locationCheckModal}</>
}

function ConfirmationStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const [carriedVisualCount, , clearVisualCountCarry] = useVisualCountCarry(tripId)
  const initial: ConfirmationEvidence = { ...CONFIRMATION_INITIAL_BASE, driverVisualCount: carriedVisualCount }
  const { draft, onUpdate, onComplete, locationCheckModal } = usePhaseStepController<ConfirmationEvidence>(
    trip, phase, slug, isFinalStep, initial, onHandOff,
    () => clearVisualCountCarry(),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return <>{renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })}{locationCheckModal}</>
}
