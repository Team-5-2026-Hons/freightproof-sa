// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx
//
// Replaces the deleted app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx.
// The URL keys on phase_type (see page.tsx and lib/phase/routes.ts's header note) — the
// actual phase_event_id a driver is addressing is resolved here, client-side, from
// TripContext via actionablePhase(trip.phases). A cross-dock plan can visit `unloading`
// (say) more than once; the URL alone can never disambiguate which occurrence, only the
// ledger can — which is exactly why the guard below redirects on any mismatch instead of
// trusting the URL's [type] segment at face value.
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
  waybillPhotoDataUrl: null, waybillPhotoArtifactId: null, sealNumber: null,
  sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
}
const UNLOADING_INITIAL: UnloadingEvidence = {
  waybillHandedOver: null, sealNumberAtDestination: null,
  sealIntactPhotoDataUrl: null, sealIntactPhotoArtifactId: null,
  driverVisualCount: null, capturedAt: null,
}
// driverVisualCount is seeded per-mount from the carry-forward hook (task 4) — see
// ConfirmationStep below — never hard-coded here.
const CONFIRMATION_INITIAL_BASE: Omit<ConfirmationEvidence, 'driverVisualCount'> = {
  podPhotoDataUrl: null, podPhotoArtifactId: null,
  podSignatureDataUrl: null, podSignatureArtifactId: null,
  recipientName: null, recipientIdNumber: null,
  reconciliationNote: null, capturedAt: null,
}

// STEP_REGISTRY's ComponentType<never> intentionally erases each step's real prop shape
// (components/phase/steps/registry.ts's header comment) so the map can hold sixteen
// components with genuinely different props without weakening any one of them. This is
// the one place that erasure is re-widened. Each call site below still builds a fully
// typed `props` object against the REAL evidence type for that phase (see the XStep
// components), so a wrong field name is still a compile error at construction time —
// only the final JSX call itself can't cross-check against the resolved component's own
// declared interface.
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

// Thin gate: decides WHETHER the step screen renders at all, before any hook that
// depends on a real trip ever mounts. Mirrors the old HandshakeStepPageClient's split —
// see the Fix 1/Fix 2 comments below — so usePhaseDraft/useVisualCountCarry (owned
// further down, by the XStep components) can never mount with an empty tripId or key off
// a phase that hasn't loaded yet.
export default function PhaseStepPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  // Fix 2 (submit-triggered spinner/"not found" flash): tracks whether a phase submit is
  // currently in flight. Latched true at hand-off and never reset here — every path out
  // of a hand-off navigates to a different top-level route, unmounting this component and
  // discarding the flag for free.
  //
  // Still needed even though the hand-off itself is now synchronous: the submission it
  // starts runs on in lib/submission/phase-submitter.ts and can still toggle TripContext's
  // SHARED isLoading (its 409 path refetches) — and once confirmation's last step lands,
  // /trips/me/active legitimately returns null while this component is still mounted.
  const [isHandingOff, setIsHandingOff] = useState(false)
  // Generalised across screens now that submissions outlive the page that started them:
  // a submission handed off from the PREVIOUS phase can still be running while the driver
  // stands on this one, and its refetch must not knock this screen out either.
  const { inFlight } = usePhaseSubmissions()
  const isSubmitting = isHandingOff || inFlight.length > 0

  // Fix 2 (trip-closing case): once confirmation's last step submits, the trip is
  // CLOSED — refetching /trips/me/active legitimately returns null — while the success
  // toast fires and the driver is routed away. Without a fallback, the render in that
  // window falls into the `!trip` branch and flashes "Trip not found" before the
  // navigation actually takes effect. Written in an effect (post-commit), never during
  // render, for the same reasons the old page client's version was.
  const lastTripRef = useRef<Trip | null>(null)
  useEffect(() => {
    if (trip) lastTripRef.current = trip
  }, [trip])

  // The plan as it stood the instant the driver swiped, pinned for as long as this
  // component survives the route change. Without it the optimistic advance would turn
  // this screen against itself: marking the phase resolved moves currentPhase() on, which
  // makes PhaseStepContent's own mismatch guard fire and router.replace() the driver into
  // the NEXT phase's first step — the exact "marched straight into the next phase"
  // behaviour Workstream 1 exists to remove — racing the push to Home that was already
  // issued. Nothing downstream needs a fresher plan than this: the screen is leaving.
  const handedOffTripRef = useRef<Trip | null>(null)
  const beginHandOff = useCallback(() => {
    handedOffTripRef.current = lastTripRef.current
    setIsHandingOff(true)
  }, [])

  const activeTrip = (isHandingOff ? handedOffTripRef.current : null)
    ?? trip
    ?? (isSubmitting ? lastTripRef.current : null)

  // Fix 1 (CRITICAL evidence-wipe bug, carried over unchanged): the (app) layout only
  // gates children on auth, not on TripContext.isLoading — so a hard reload, PWA
  // relaunch, or a push-notification deep link straight into a phase step can mount this
  // page while `trip` is still null. usePhaseDraft/useVisualCountCarry
  // key their localStorage reads off tripId inside a useState lazy initializer that only
  // ever runs on first mount — if they mounted with tripId = '' before the trip loaded,
  // they'd read the WRONG storage keys, start empty, and the driver's very next
  // onUpdate() call would overwrite the CORRECT (real-tripId) key with that empty state,
  // permanently erasing previously captured evidence. The fix: PhaseStepContent (and
  // everything it renders) never mounts until `trip` is a real, non-null object.
  //
  // Gated on having no trip at all rather than on isLoading alone: a background refetch
  // while the driver is mid-capture should not blank their screen to a spinner when we
  // already hold a perfectly good plan to render.
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
  // background. One-way by design: nothing resets it, because every path out of a
  // hand-off is a route change that unmounts this component.
  onHandOff: () => void
}

// Everything that needs a real, non-null trip lives here (see Fix 1 above) — most
// importantly the type-mismatch guard, which is this route's whole reason for existing
// as a client-resolved redirect rather than a plain static page.
function PhaseStepContent({ trip, onHandOff }: PhaseStepContentProps) {
  const { type, slug } = useParams<{ type: string; slug: string }>()
  const router = useRouter()

  // generateStaticParams (page.tsx) only ever emits combinations drawn from
  // STEP_SLUGS's own keys, so every statically-exported instance of this route already
  // has a real PhaseType in its URL — this cast just names what build time guarantees.
  const urlPhaseType = type as PhaseType

  // actionablePhase, NOT currentPhase: the two differ for the whole drive, because the
  // backend holds the driverless `in_transit` row PENDING from departure until arrival.
  // Guarding on currentPhase deadlocked the trip — this screen demanded the ledger
  // already be on `unloading`, while the only thing that moves the ledger to `unloading`
  // is a submit from this screen. The driver was bounced back to the trip page every
  // time they pressed "Arrive at destination". See lib/phase/derive.ts.
  const phase = actionablePhase(trip.phases)
  const steps = phase !== null ? stepsFor(phase) : []
  // Guard: the phase the driver is due on may not be the one this URL addresses — a stale
  // back-navigation, a bookmarked deep link, or a submit that just advanced the trip to
  // its next phase in another tab. Trusting the URL here would submit evidence against
  // the wrong phase_event_id row (or, worse, a phase that's already resolved). Redirect
  // to wherever the ledger actually puts the driver instead.
  //
  // No `steps.length === 0` arm: actionablePhase only ever returns a phase WITH a recipe,
  // so an empty one is unreachable by construction rather than by check.
  const mismatched = phase === null || phase.phase_type !== urlPhaseType

  useEffect(() => {
    if (mismatched) router.replace(currentStepRoute(trip.phases))
  }, [mismatched, trip.phases, router])

  if (phase === null || mismatched) {
    // The redirect above is already in flight — this is the frame the driver sees while
    // it lands, so it gets the same loading treatment as a genuine fetch.
    return <LoadingScreen label="Loading step" />
  }

  const stepIndex = steps.findIndex((s) => s.slug === slug)
  if (stepIndex === -1) {
    return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  }

  return (
    // Keyed on phase_event_id — not just phase_type — so navigating between two
    // occurrences of the SAME phase type on a cross-dock plan (e.g. unloading at stop 1,
    // then unloading again at stop 2) fully remounts this subtree. Without the key,
    // React would reconcile the same component instance across that transition (same
    // element type at the same tree position) and usePhaseDraft's internal state
    // wouldn't reset to the new phase_event_id's own stored draft.
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

// Pure dispatch on phase_type — calls no hooks of its own. Each branch below mounts a
// SEPARATE component (ActivationStep, LoadingStep, ...), each with its own single,
// concretely-typed usePhaseDraft<T> call. This split — rather than one component
// switching on phase_type internally — is required, not stylistic: usePhaseDraft can't
// be called with a union evidence type (Partial<A | B | ...> collapses to only the
// fields every member happens to share, which across these five is just `capturedAt`),
// and calling a DIFFERENT usePhaseDraft per branch inside one component would violate
// the Rules of Hooks the moment phase_type actually changed between renders. Different
// component types at the same position is how React is meant to express that kind of
// variant, and PhaseStepContent's `key` above guarantees a full remount even when the
// type does NOT change (the repeated-phase-type cross-dock case).
function PhaseStepRouter(props: StepControllerProps) {
  switch (props.phase.phase_type) {
    case 'activation': return <ActivationStep {...props} />
    case 'loading': return <LoadingStep {...props} />
    case 'departure': return <DepartureStep {...props} />
    case 'unloading': return <UnloadingStep {...props} />
    case 'confirmation': return <ConfirmationStep {...props} />
    case 'trip_creation':
    case 'in_transit':
      // Unreachable: PhaseStepContent's guard redirects away whenever the current
      // phase's step recipe is empty, and these are the two phase types with one
      // (phase-meta.ts). in_transit joined trip_creation when its '1-arrival' GPS step
      // was removed; it IS driver-submitted again as of 2026-08-09, but from the
      // in-transit hub's swipe rather than a step page, so it still never reaches here.
      // These cases exist only so the switch stays exhaustive.
      return null
    default: {
      const unreachable: never = props.phase.phase_type
      throw new Error(`PhaseStepRouter: unhandled phase type "${String(unreachable)}"`)
    }
  }
}

type RecordedNotice = 'anchored' | 'anchoring' | 'plain'

// Shared submission machinery for every phase type that DOES have a PhaseCompleteRequest
// variant (activation, loading, departure, unloading, confirmation — see
// lib/api/phases.ts's PhaseCompleteRequest union). One instance per XStep component,
// each with its own concrete T, so this stays a single, unconditional hook call per
// component (see PhaseStepRouter's header comment on why that split exists).
function usePhaseStepController<T extends PhaseEvidence>(
  trip: Trip,
  phase: PhaseDescriptor,
  slug: string,
  isFinalStep: boolean,
  initial: T,
  onHandOff: () => void,
  // Runs once a submission is resolved (by any path — real success, offline queue, or a
  // 409 that turns out to be an earlier attempt's success) but BEFORE the draft is
  // cleared, so a phase-specific carry-forward write (departure's seal, unloading's
  // visual count) still has the just-captured evidence to read from.
  onResolved: (freshTrip: Trip | null, evidence: T) => void,
  // onComplete is synchronous on EVERY step now — mid-phase steps navigate, and the final
  // step hands its submission to the background submitter and navigates. The union return
  // type is kept because the step components all declare it (components/phase/steps/**),
  // and because SwipeToConfirm treats a synchronous onConfirm as "stay latched, the caller
  // is navigating" — which is exactly right here and is what stops a second swipe firing a
  // duplicate confirm into an in-flight route change.
): { draft: T; onUpdate: (patch: Partial<T>) => void; onComplete: () => void | Promise<void> } {
  const router = useRouter()
  const { notify } = useToast()
  const { enqueuePhase } = useOfflineQueue()
  const { refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing } = useTrip()
  const { capturePosition } = useLocationTrail()
  const tripId = String(trip.id)

  const [draft, updateDraftRaw, clearDraft] = usePhaseDraft<T>(tripId, phase.phase_event_id, initial)

  // Mirrors `draft` synchronously. Every submittable phase's FINAL step either reviews
  // already-captured evidence (no onUpdate call at all — e.g. confirmation/Closed.tsx)
  // or, for loading and unloading, calls onUpdate(patch) immediately followed by
  // onComplete() in the SAME event handler (see loading/VisualCount.tsx's
  // handleConfirm). React's setDraft update from usePhaseDraft doesn't land until the
  // next render, so reading `draft` itself inside submitAndAdvance would submit
  // whatever was on screen BEFORE that final patch. onUpdate below updates this ref in
  // the same tick it forwards the patch to usePhaseDraft, so submitAndAdvance always
  // reads the just-captured value via draftRef.current.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  function onUpdate(patch: Partial<T>) {
    draftRef.current = { ...draftRef.current, ...patch }
    updateDraftRaw(patch)
  }

  // Generated once per logical submission attempt and reused across manual retries of
  // THIS SAME attempt (a transient failure followed by the driver tapping submit again)
  // — the online-path counterpart to the offline queue's own per-entry key
  // (lib/hooks/useOfflineQueue.ts). Every hand-off navigates away, unmounting this hook
  // instance for good, so a fresh key is only ever needed for a genuinely new attempt —
  // which naturally gets one, from a fresh mount after a rolled-back failure.
  const idempotencyKeyRef = useRef<string | null>(null)

  // The anchored set is ANCHORED_PHASES (phase-meta.ts): trip_creation, departure,
  // confirmation — not loading/unloading, which is what the OLD (deleted)
  // HandshakeStepPageClient.anchoring.test.tsx hard-coded and is now wrong.
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

  // Mid-phase only. isFinalStep decides which of the two onComplete implementations a
  // step gets, so by construction nextStepRoute here can only ever return the next slug
  // in THIS phase's own recipe — the end-of-phase walk it also knows how to do is
  // deliberately unreachable from this branch, because a finished phase now goes Home.
  function advanceWithinPhase() {
    router.push(nextStepRoute(trip.phases, phase, slug))
  }

  // Everything that used to happen inline, after the await, now happens here — called by
  // lib/submission/phase-submitter.ts from wherever the driver has since navigated to.
  // Every function it closes over survives this component unmounting: notify belongs to
  // the root ToastProvider, adoptTrip/clearPhaseSyncing to TripProvider, router.push to
  // the app router, and clearDraft/onResolved write their localStorage synchronously
  // before touching any component state.
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
        // Draft deliberately NOT cleared, and the optimistic advance deliberately KEPT:
        // the queue holds the evidence and will replay it, so re-offering the step would
        // only invite a second copy of the same submission. OfflineBanner already tells
        // the driver, on every screen, that something is waiting to sync.
        return
      }
      case 'conflict':
      case 'failed': {
        // Roll the optimistic advance back — the phase reads unresolved again, Home
        // re-offers the step, and the untouched draft is still there when they open it.
        clearPhaseSyncing(phase.phase_event_id)
        notify({
          kind: 'error',
          title: outcome.kind === 'conflict' ? 'Could not confirm phase' : 'Could not submit',
          // The server's own detail, not a hardcoded sentence: every 409 the backend
          // raises describes its actual cause (an unresolved earlier phase, or a trip
          // that isn't due until a stated date), and a fixed string discarded all of it.
          body: outcome.message,
        })
        // The toast fades; the failure notice in OfflineBanner does not, because a driver
        // who missed it would otherwise believe evidence was recorded when it was not.
        return
      }
      default: {
        const unreachable: never = outcome
        throw new Error(`handleOutcome: unhandled outcome "${String(unreachable)}"`)
      }
    }
  }

  // The whole point of Workstream 1: synchronous, so the driver is on Home before the
  // first byte of their evidence leaves the phone.
  function handOffSubmission() {
    onHandOff()
    if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = crypto.randomUUID()
    const evidence = draftRef.current

    // Return value deliberately ignored: `false` means a submission for this exact
    // phase_event_id is already running, and the right response to that is still to mark
    // and navigate — the driver's evidence is on its way either way, and leaving them on
    // the step screen would only invite a third swipe.
    startPhaseSubmission({
      tripId,
      phaseEventId: phase.phase_event_id,
      phaseType: phase.phase_type,
      evidence,
      idempotencyKey: idempotencyKeyRef.current,
      // Started here, at the moment the driver confirms — but NOT awaited. A cold GPS can
      // take ten seconds to produce a first fix, and that must never sit between the
      // swipe and the transition. The submitter waits for it instead, so the position
      // still travels WITH the evidence (including into the offline queue) and a replay
      // hours later still says where the driver actually was when they swiped.
      position: capturePosition(),
      enqueuePhase,
      refetchTrip,
      onOutcome: (outcome) => handleOutcome(outcome, evidence),
    })

    // Order matters: mark before navigating, so Home's very first render already sees
    // this phase resolved rather than re-offering the step for a frame.
    markPhaseSyncing(phase.phase_event_id)
    router.push(ROUTES.home)
  }

  // The final step of a phase always returns the driver Home — it is what makes the
  // in-transit hub reachable, and it is the difference between finishing a phase and
  // being marched straight into the next one.
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

// Exported (rather than kept module-private like its sibling XStep functions) so
// components/phase/steps/__tests__/linehaul.test.tsx can render through the real call
// site — see that test's header comment on why the isolated-component test alone can't
// catch a missing prop here (renderStep's ComponentType<never> cast).
export function LoadingStep({ trip, phase, slug, stepIndex, isFinalStep, onHandOff }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete } = usePhaseStepController<LoadingEvidence>(
    trip, phase, slug, isFinalStep, LOADING_INITIAL, onHandOff, () => {},
  )

  // Null is a NORMAL state, not an error: lib/api/manifest.ts returns null for any trip
  // created without a Parcel Perfect reference, which it documents as common. The step
  // renders dashes and stays confirmable — the driver still has the paper sheet, and
  // blocking him over a document the trip never had would be the wrong failure direction.
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
  // No carry-forward. The seal committed here used to be persisted per-trip
  // (useSealReference) so `unloading` could display it as a reference to type against;
  // that display is gone (2026-08-05) because showing a driver the expected number is
  // not verification. advance_unloading compares against this leg's own departure event
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
  // No per-slug extra props any more: SealVerify's referenceSealNumber was the only one,
  // and the seal is now entered blind (see that component's header comment).
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

// InTransitStep is gone with in_transit's step recipe. Its single step ('1-arrival')
// only ever asked the driver to capture a GPS fix that submitPhase never sent anywhere.
//
// The phase DOES have a PhaseCompleteRequest variant again as of 2026-08-09
// (InTransitCompleteRequest / advance_in_transit) and the driver does submit it — but
// from the in-transit hub's "Arrive at destination" swipe, deliberately not from a step
// page: a step recipe would perturb actionablePhase() and force a change to the shared
// STEP_SLUGS contract. So the recipe stays empty, PhaseStepContent's guard still
// redirects away before this phase can address a step page, and this file stays out of
// it — exactly as it always has for trip_creation.
