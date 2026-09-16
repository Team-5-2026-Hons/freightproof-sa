// The URL keys on phase_type only; the real phase_event_id a driver is addressing is
// resolved here from TripContext via actionablePhase(trip.phases), since a cross-dock
// plan can visit the same phase type more than once and only the ledger can disambiguate.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { ComponentType } from 'react'
import { usePhaseDraft } from '@/lib/hooks/usePhaseDraft'
import { useVisualCountCarry } from '@/lib/hooks/useVisualCountCarry'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import {
  startPhaseSubmission, usePhaseSubmissions, type PhaseSubmissionOutcome,
} from '@/lib/submission/phase-submitter'
import { actionablePhase, stepsFor, nextStepRoute, currentStepRoute, isAnchored } from '@/lib/phase'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Button } from '@/components/ui/Button'
import { HoldNotice } from '@/components/trip/HoldNotice'
import { stepComponentFor } from '@/components/phase/steps/registry'
import { fetchLinehaul } from '@/lib/api/manifest'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { Linehaul as LinehaulDocument } from '@shared/lib/types/manifest'
import type {
  ActivationEvidence, LoadingEvidence, DepartureEvidence, UnloadingEvidence,
  ConfirmationEvidence, PhaseEvidence,
} from '@/lib/types/evidence-draft'

const ACTIVATION_INITIAL: ActivationEvidence = { capturedAt: null }
const LOADING_INITIAL: LoadingEvidence = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null, capturedAt: null,
}
const DEPARTURE_INITIAL: DepartureEvidence = {
  sealNumber: null, sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
const UNLOADING_INITIAL: UnloadingEvidence = {
  waybillHandedOver: null, sealNumberAtDestination: null,
  sealIntactPhotoDataUrl: null, sealIntactPhotoArtifactId: null,
  driverVisualCount: null, capturedAt: null,
}
// driverVisualCount is seeded per-mount from the carry-forward hook — see ConfirmationStep.
const CONFIRMATION_INITIAL_BASE: Omit<ConfirmationEvidence, 'driverVisualCount'> = {
  podPhotoDataUrl: null, podPhotoArtifactId: null,
  podSignatureArtifactId: null, receiverConfirmedAt: null,
  reconciliationNote: null, capturedAt: null,
}

// The one place STEP_REGISTRY's ComponentType<never> erasure is re-widened. Callers still
// build a fully typed props object against the real evidence type, so a wrong field name
// is still a compile error at construction — only this final JSX call can't cross-check.
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

// Gate: decides whether the step screen renders at all, before any hook that depends on
// a real trip ever mounts.
export default function PhaseStepPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  // Tracks whether a phase submit is in flight. Latched true at hand-off and never reset
  // here — every hand-off path navigates to a different route, unmounting this component.
  const [isHandingOff, setIsHandingOff] = useState(false)
  // A submission handed off from the PREVIOUS phase can still be running while the driver
  // stands on this one; its refetch must not knock this screen out either.
  const { inFlight } = usePhaseSubmissions()
  const isSubmitting = isHandingOff || inFlight.length > 0

  // Once confirmation's last step submits, the trip is closed and /trips/me/active
  // legitimately returns null while this component is still mounted mid-navigation.
  // Without this fallback the render flashes "Trip not found" before navigation lands.
  const lastTripRef = useRef<Trip | null>(null)
  useEffect(() => {
    if (trip) lastTripRef.current = trip
  }, [trip])

  // The plan as it stood the instant the driver swiped, pinned for the rest of this
  // component's life. Without it, marking the phase resolved would fire the mismatch
  // guard below and redirect into the next phase, racing the Home navigation already issued.
  const handedOffTripRef = useRef<Trip | null>(null)
  const beginHandOff = useCallback(() => {
    handedOffTripRef.current = lastTripRef.current
    setIsHandingOff(true)
  }, [])

  const activeTrip = (isHandingOff ? handedOffTripRef.current : null)
    ?? trip
    ?? (isSubmitting ? lastTripRef.current : null)

  // CRITICAL: the (app) layout gates children on auth only, not on TripContext.isLoading.
  // usePhaseDraft/useVisualCountCarry key their localStorage reads off tripId in a lazy
  // initializer that only runs on first mount, so mounting them with tripId = '' before
  // the trip loads would silently overwrite real captured evidence on the next onUpdate().
  // PhaseStepContent must never mount until `trip` is a real, non-null object.
  //
  // Gated on having no trip at all, not on isLoading alone, so a background refetch
  // mid-capture doesn't blank the screen to a spinner.
  if (activeTrip === null) {
    if (isLoading) return <LoadingScreen label="Loading trip" />
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  // Blocks every step screen (including deep links) while the trip is held — any phase
  // submit in this state can only 409, so there's nothing to do here.
  if (activeTrip.status === 'exception_hold') {
    return (
      <main className="flex min-h-dvh flex-col justify-center gap-4 p-6">
        <HoldNotice />
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.activeTripDetail)}>
          View trip
        </Button>
      </main>
    )
  }

  return <PhaseStepContent trip={activeTrip} onHandOff={beginHandOff} />
}

interface PhaseStepContentProps {
  trip: Trip
  // Called once, synchronously, when the driver's swipe hands a submission to the
  // background. One-way by design: nothing resets it.
  onHandOff: () => void
}

// Everything that needs a real, non-null trip lives here, most importantly the
// type-mismatch guard — this route's whole reason for being a client-resolved redirect.
function PhaseStepContent({ trip, onHandOff }: PhaseStepContentProps) {
  const { type, slug } = useParams<{ type: string; slug: string }>()
  const router = useRouter()

  // generateStaticParams (page.tsx) only emits combinations from STEP_SLUGS, so this
  // cast just names what build time guarantees.
  const urlPhaseType = type as PhaseType

  // actionablePhase, not currentPhase: the backend holds the driverless in_transit row
  // PENDING from departure until arrival, and guarding on currentPhase deadlocked the
  // trip — the driver was bounced back every time they pressed "Arrive". See lib/phase/derive.ts.
  const phase = actionablePhase(trip.phases)
  const steps = phase !== null ? stepsFor(phase) : []
  // The phase the driver is due on may not be the one this URL addresses (stale
  // back-navigation, bookmarked deep link, a submit from another tab) — redirect to
  // wherever the ledger actually puts the driver instead of trusting the URL.
  //
  // No `steps.length === 0` arm: actionablePhase only ever returns a phase with a recipe.
  const mismatched = phase === null || phase.phase_type !== urlPhaseType

  useEffect(() => {
    if (mismatched) router.replace(currentStepRoute(trip.phases))
  }, [mismatched, trip.phases, router])

  if (phase === null || mismatched) {
    // The redirect above is already in flight; treat this frame like a genuine fetch.
    return <LoadingScreen label="Loading step" />
  }

  const stepIndex = steps.findIndex((s) => s.slug === slug)
  if (stepIndex === -1) {
    return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  }

  return (
    // Keyed on phase_event_id, not just phase_type, so navigating between two occurrences
    // of the same phase type on a cross-dock plan fully remounts this subtree instead of
    // reconciling the same instance and leaving usePhaseDraft's state stale.
    <PhaseStepRouter
      key={phase.phase_event_id}
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

// Pure dispatch on phase_type, calling no hooks of its own. Each branch mounts a separate
// component with its own concretely-typed usePhaseDraft<T> call — required, not stylistic:
// usePhaseDraft can't take a union evidence type, and switching phase_type inside one
// component would violate the Rules of Hooks when phase_type changes between renders.
function PhaseStepRouter(props: StepControllerProps) {
  switch (props.phase.phase_type) {
    case 'activation': return <ActivationStep {...props} />
    case 'loading': return <LoadingStep {...props} />
    case 'departure': return <DepartureStep {...props} />
    case 'unloading': return <UnloadingStep {...props} />
    case 'confirmation': return <ConfirmationStep {...props} />
    case 'trip_creation':
    case 'in_transit':
      // Unreachable: PhaseStepContent's guard redirects away whenever the current phase's
      // step recipe is empty, which is true for both these types. Kept for exhaustiveness.
      return null
    default: {
      const unreachable: never = props.phase.phase_type
      throw new Error(`PhaseStepRouter: unhandled phase type "${String(unreachable)}"`)
    }
  }
}

type RecordedNotice = 'anchored' | 'anchoring' | 'plain'

// Shared submission machinery for every phase type with a PhaseCompleteRequest variant.
// One instance per XStep component, each with its own concrete T, keeping this a single
// unconditional hook call per component.
function usePhaseStepController<T extends PhaseEvidence>(
  trip: Trip,
  phase: PhaseDescriptor,
  slug: string,
  isFinalStep: boolean,
  initial: T,
  onHandOff: () => void,
  // Runs once a submission resolves, but before the draft clears, so a phase-specific
  // carry-forward write still has the just-captured evidence to read from.
  onResolved: (freshTrip: Trip | null, evidence: T) => void,
  // Synchronous on every step: mid-phase steps navigate, the final step hands off to the
  // background submitter and navigates. SwipeToConfirm treats a synchronous onConfirm as
  // "stay latched, caller is navigating", which stops a second swipe firing a duplicate.
): { draft: T; onUpdate: (patch: Partial<T>) => void; onComplete: () => void | Promise<void> } {
  const router = useRouter()
  const { notify } = useToast()
  const { enqueuePhase } = useOfflineQueue()
  const { refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing } = useTrip()
  const { capturePosition } = useLocationTrail()
  const tripId = String(trip.id)

  const [draft, updateDraftRaw, clearDraft] = usePhaseDraft<T>(tripId, phase.phase_event_id, initial)

  // Mirrors `draft` synchronously: some final steps call onUpdate(patch) immediately
  // followed by onComplete() in the same handler, before usePhaseDraft's setDraft lands
  // on the next render. draftRef.current always reads the just-captured value.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  function onUpdate(patch: Partial<T>) {
    draftRef.current = { ...draftRef.current, ...patch }
    updateDraftRaw(patch)
  }

  // Generated once per submission attempt and reused across manual retries of that same
  // attempt — the online-path counterpart to the offline queue's per-entry key.
  const idempotencyKeyRef = useRef<string | null>(null)

  // The anchored set is ANCHORED_PHASES (phase-meta.ts): trip_creation, departure, confirmation.
  function recordedNotice(addressedPhase: PhaseDescriptor | null): RecordedNotice {
    if (IS_DEMO_MODE || !isAnchored(phase)) return 'plain'
    return addressedPhase?.blockchain_receipt_id ? 'anchored' : 'anchoring'
  }

  function notifyPhaseRecorded(notice: RecordedNotice) {
    const savedAt = formatTime(new Date())
    const body =
      notice === 'anchored'
        ? `Saved . Evidence recorded and anchored to Hedera HCS.`
        : notice === 'anchoring'
          ? `Saved . Evidence recorded. Hedera anchoring in progress, track it on your trip screen.`
          : `Saved . Evidence stored on this device.`
    notify({ kind: 'success', title: `${PHASE_NAMES[phase.phase_type]} recorded`, body })
  }

  function notifyTripOnHold() {
    notify({
      kind: 'error',
      title: 'Trip on hold',
      body: 'A critical exception was recorded. The trip is paused for dispatcher review.',
    })
  }

  // Mid-phase only: isFinalStep decides which onComplete a step gets, so nextStepRoute
  // here only ever returns the next slug in this phase's own recipe.
  function advanceWithinPhase() {
    router.push(nextStepRoute(trip.phases, phase, slug))
  }

  // Called by lib/submission/phase-submitter.ts from wherever the driver has since
  // navigated to. Everything it closes over survives this component unmounting: notify
  // belongs to the root ToastProvider, adoptTrip/clearPhaseSyncing to TripProvider.
  function handleOutcome(outcome: PhaseSubmissionOutcome, evidence: T) {
    switch (outcome.kind) {
      case 'recorded': {
        onResolved(outcome.trip, evidence)
        // Only NOW, once the backend has confirmed. Clearing at hand-off would leave a
        // driver with no evidence and no record if the submission then failed.
        clearDraft()
        if (outcome.trip !== null) {
          adoptTrip(outcome.trip)
          // Reconcile: the real plan already shows this phase resolved, so dropping the
          // optimistic marker changes nothing the driver can see.
          clearPhaseSyncing(phase.phase_event_id)
        }
        // Demo mode returns no trip (no backend call happened), so the marker IS the only
        // record that this phase is done — it stays until the app is reloaded.
        notifyPhaseRecorded(recordedNotice(outcome.addressedPhase))
        return
      }
      case 'hold': {
        onResolved(outcome.trip, evidence)
        clearDraft()
        adoptTrip(outcome.trip)
        clearPhaseSyncing(phase.phase_event_id)
        notifyTripOnHold()
        // Worth interrupting for even though the driver is already Home: a critical
        // exception paused the trip, and the trip screen is where they can see why.
        router.push(ROUTES.activeTripDetail)
        return
      }
      case 'queued': {
        // Always 'plain', regardless of whether this phase is normally anchored: the
        // evidence hasn't reached the backend (or Hedera) yet, so claiming "anchoring in
        // progress" here would be dishonest.
        onResolved(null, evidence)
        notifyPhaseRecorded('plain')
        // Draft deliberately not cleared: the queue holds and replays it, so re-offering
        // the step would invite a duplicate submission. OfflineBanner tells the driver.
        return
      }
      case 'conflict':
      case 'failed': {
        // Roll the optimistic advance back — Home re-offers the step with its draft intact.
        clearPhaseSyncing(phase.phase_event_id)
        notify({
          kind: 'error',
          title: outcome.kind === 'conflict' ? 'Could not confirm phase' : 'Could not submit',
          body: outcome.message,
        })
        // The toast fades; OfflineBanner's failure notice does not.
        return
      }
      default: {
        const unreachable: never = outcome
        throw new Error(`handleOutcome: unhandled outcome "${String(unreachable)}"`)
      }
    }
  }

  // Synchronous, so the driver is on Home before the first byte of evidence leaves the phone.
  function handOffSubmission() {
    onHandOff()
    if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = crypto.randomUUID()
    const evidence = draftRef.current
    // Stamped at the same instant the driver confirms, so a replay from the offline
    // queue reports the original swipe instant, never the retry's own clock.
    const driverCapturedAt = new Date().toISOString()

    // Return value ignored: `false` just means a submission for this phase_event_id is
    // already running, and the right response is still to mark and navigate.
    startPhaseSubmission({
      tripId,
      phaseEventId: phase.phase_event_id,
      phaseType: phase.phase_type,
      evidence,
      idempotencyKey: idempotencyKeyRef.current,
      driverCapturedAt,
      // Not awaited: a cold GPS fix can take seconds and must never delay the transition.
      // The submitter awaits it itself, so position still travels with the evidence.
      position: capturePosition(),
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleOutcome(outcome, evidence),
    })

    // Mark before navigating, so Home's first render already sees this phase resolved.
    markPhaseSyncing(phase.phase_event_id)
    router.push(ROUTES.home)
  }

  // The final step of a phase always returns the driver Home rather than into the next one.
  const onComplete = isFinalStep ? handOffSubmission : advanceWithinPhase

  return { draft, onUpdate, onComplete }
}

function ActivationStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete } = usePhaseStepController<ActivationEvidence>(
    trip, phase, slug, isFinalStep, ACTIVATION_INITIAL, onHandOff, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

// Exported (unlike its sibling XStep functions) so
// components/phase/steps/__tests__/linehaul.test.tsx can render through the real call site.
export function LoadingStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete } = usePhaseStepController<LoadingEvidence>(
    trip, phase, slug, isFinalStep, LOADING_INITIAL, onHandOff, () => {},
  )

  // Null is normal, not an error: lib/api/manifest.ts returns null for any trip without a
  // Parcel Perfect reference. The step renders dashes and stays confirmable regardless.
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
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete, linehaul })
}

function DepartureStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  // No carry-forward: advance_unloading compares against this leg's own departure event
  // server-side, so nothing on the device needs to remember the seal.
  const { draft, onUpdate, onComplete } = usePhaseStepController<DepartureEvidence>(
    trip, phase, slug, isFinalStep, DEPARTURE_INITIAL, onHandOff, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

function UnloadingStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const [, setVisualCountCarry] = useVisualCountCarry(tripId)
  const { draft, onUpdate, onComplete } = usePhaseStepController<UnloadingEvidence>(
    trip, phase, slug, isFinalStep, UNLOADING_INITIAL, onHandOff,
    (_freshTrip, evidence) => setVisualCountCarry(evidence.driverVisualCount),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

function ConfirmationStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const [carriedVisualCount, , clearVisualCountCarry] = useVisualCountCarry(tripId)
  const initial: ConfirmationEvidence = { ...CONFIRMATION_INITIAL_BASE, driverVisualCount: carriedVisualCount }
  const { draft, onUpdate, onComplete } = usePhaseStepController<ConfirmationEvidence>(
    trip, phase, slug, isFinalStep, initial, onHandOff,
    () => clearVisualCountCarry(),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

// No InTransitStep: in_transit is submitted from the in-transit hub's "Arrive at
// destination" swipe, not a step page, so its recipe stays empty and this file stays out
// of it — same as trip_creation.
