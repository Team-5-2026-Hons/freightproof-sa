// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx
//
// Replaces the deleted app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx.
// The URL keys on phase_type (see page.tsx and lib/phase/routes.ts's header note) — the
// actual phase_event_id a driver is addressing is resolved here, client-side, from
// TripContext via currentPhase(trip.phases). A cross-dock plan can visit `unloading`
// (say) more than once; the URL alone can never disambiguate which occurrence, only the
// ledger can — which is exactly why the guard below redirects on any mismatch instead of
// trusting the URL's [type] segment at face value.
'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { ComponentType } from 'react'
import { usePhaseDraft } from '@/lib/hooks/usePhaseDraft'
import { useSealReference } from '@/lib/hooks/useSealReference'
import { useVisualCountCarry } from '@/lib/hooks/useVisualCountCarry'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { submitPhase } from '@/lib/api/phases'
import { ApiError } from '@/lib/api/client'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import { currentPhase, stepsFor, phaseStepRoute, nextStepRoute, isAnchored } from '@/lib/phase'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { ROUTES } from '@/lib/constants/routes'
import { formatTime } from '@/lib/utils/format-time'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { HoldNotice } from '@/components/trip/HoldNotice'
import { stepComponentFor } from '@/components/phase/steps/registry'
import type { ArrivalDraft } from '@/components/phase/steps/in_transit/Arrival'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type {
  ActivationEvidence, LoadingEvidence, DepartureEvidence, UnloadingEvidence,
  ConfirmationEvidence, PhaseEvidence,
} from '@/lib/types/evidence-draft'

const ACTIVATION_INITIAL: ActivationEvidence = { gpsLat: null, gpsLng: null, gateAddress: null, capturedAt: null }
const LOADING_INITIAL: LoadingEvidence = { driverVisualCount: null, capturedAt: null }
const DEPARTURE_INITIAL: DepartureEvidence = {
  gpsLat: null, gpsLng: null, waybillPhotoDataUrl: null, sealNumber: null,
  sealPhotoDataUrl: null, sealNumberConfirmed: null, sealVerifiedMatch: null, capturedAt: null,
}
const UNLOADING_INITIAL: UnloadingEvidence = {
  waybillHandedOver: null, sealNumberAtDestination: null, sealVerifiedMatch: null,
  sealBrokenPhotoDataUrl: null, driverVisualCount: null, capturedAt: null,
}
// driverVisualCount is seeded per-mount from the carry-forward hook (task 4) — see
// ConfirmationStep below — never hard-coded here.
const CONFIRMATION_INITIAL_BASE: Omit<ConfirmationEvidence, 'driverVisualCount'> = {
  podPhotoDataUrl: null, podSignatureDataUrl: null, reconciliationNote: null, capturedAt: null,
}
const ARRIVAL_INITIAL: ArrivalDraft = { gpsLat: null, gpsLng: null, capturedAt: null }

// The route for wherever the ledger says the driver is right now — used both by the
// type-mismatch guard below and (duplicated, see that file's own comment) by
// InTransitPageClient's "Arrive at destination" button. Composed entirely from
// lib/phase's own exports; lib/phase/ itself is out of scope for this task, so this
// stays local rather than becoming a second export from that module.
function currentStepRoute(phases: readonly PhaseDescriptor[]): string {
  const phase = currentPhase(phases)
  if (phase === null) return ROUTES.trips // nothing left unresolved — trip finished
  const steps = stepsFor(phase)
  // Defensive: only trip_creation has an empty recipe, and it resolves at trip creation
  // before the driver is ever involved — currentPhase should never surface it here.
  return steps.length > 0 ? phaseStepRoute(phase.phase_type, steps[0].slug) : ROUTES.activeTripDetail
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
// see the Fix 1/Fix 2 comments below — so usePhaseDraft/useSealReference/
// useVisualCountCarry (owned further down, by the XStep components) can never mount
// with an empty tripId or key off a phase that hasn't loaded yet.
export default function PhaseStepPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  // Fix 2 (submit-triggered spinner/"not found" flash): tracks whether a phase submit
  // is currently in flight. submitAndAdvance (inside usePhaseStepController) awaits the
  // backend call and, on a 409, a refetch — both of which can toggle TripContext's
  // SHARED isLoading — without this flag the step UI (including SwipeToConfirm's own
  // "Submitting…" state) would flash a full-screen spinner mid-submit. Only reset back
  // to false on paths that keep the driver on THIS screen; every success/queued path
  // navigates to a different top-level route, unmounting this component and discarding
  // the flag for free.
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fix 2 (trip-closing case): once confirmation's last step submits, the trip is
  // CLOSED — refetching /trips/me/active legitimately returns null — while the success
  // toast fires and the driver is routed to ROUTES.trips. Without a fallback, the render
  // in that window falls into the `!trip` branch and flashes "Trip not found" before the
  // navigation actually takes effect. Written in an effect (post-commit), never during
  // render, for the same reasons the old page client's version was.
  const lastTripRef = useRef<Trip | null>(null)
  useEffect(() => {
    if (trip) lastTripRef.current = trip
  }, [trip])

  // Fix 1 (CRITICAL evidence-wipe bug, carried over unchanged): the (app) layout only
  // gates children on auth, not on TripContext.isLoading — so a hard reload, PWA
  // relaunch, or a push-notification deep link straight into a phase step can mount this
  // page while `trip` is still null. usePhaseDraft/useSealReference/useVisualCountCarry
  // key their localStorage reads off tripId inside a useState lazy initializer that only
  // ever runs on first mount — if they mounted with tripId = '' before the trip loaded,
  // they'd read the WRONG storage keys, start empty, and the driver's very next
  // onUpdate() call would overwrite the CORRECT (real-tripId) key with that empty state,
  // permanently erasing previously captured evidence. The fix: PhaseStepContent (and
  // everything it renders) never mounts until `trip` is a real, non-null object.
  if (isLoading && !isSubmitting) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  const activeTrip = trip ?? (isSubmitting ? lastTripRef.current : null)

  if (!activeTrip) {
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

  return <PhaseStepContent trip={activeTrip} setIsSubmitting={setIsSubmitting} />
}

interface PhaseStepContentProps {
  trip: Trip
  setIsSubmitting: (isSubmitting: boolean) => void
}

// Everything that needs a real, non-null trip lives here (see Fix 1 above) — most
// importantly the type-mismatch guard, which is this route's whole reason for existing
// as a client-resolved redirect rather than a plain static page.
function PhaseStepContent({ trip, setIsSubmitting }: PhaseStepContentProps) {
  const { type, slug } = useParams<{ type: string; slug: string }>()
  const router = useRouter()

  // generateStaticParams (page.tsx) only ever emits combinations drawn from
  // STEP_SLUGS's own keys, so every statically-exported instance of this route already
  // has a real PhaseType in its URL — this cast just names what build time guarantees.
  const urlPhaseType = type as PhaseType

  const phase = currentPhase(trip.phases)
  const steps = phase !== null ? stepsFor(phase) : []
  // Guard: the ledger's current phase may not be the one this URL addresses — a stale
  // back-navigation, a bookmarked deep link, or a submit that just advanced the trip to
  // its next phase in another tab. Trusting the URL here would submit evidence against
  // the wrong phase_event_id row (or, worse, a phase that's already resolved). Redirect
  // to wherever the ledger actually says "current" instead.
  const mismatched = phase === null || phase.phase_type !== urlPhaseType || steps.length === 0

  useEffect(() => {
    if (mismatched) router.replace(currentStepRoute(trip.phases))
  }, [mismatched, trip.phases, router])

  if (phase === null || mismatched) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Spinner />
      </main>
    )
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
      setIsSubmitting={setIsSubmitting}
    />
  )
}

interface StepControllerProps {
  trip: Trip
  phase: PhaseDescriptor
  slug: string
  stepIndex: number
  isFinalStep: boolean
  setIsSubmitting: (isSubmitting: boolean) => void
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
    case 'in_transit': return <InTransitStep {...props} />
    case 'trip_creation':
      // Unreachable: PhaseStepContent's guard redirects away whenever the current
      // phase's step recipe is empty, and trip_creation is the only phase type with one
      // (phase-meta.ts) — this case exists only so the switch stays exhaustive.
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
  setIsSubmitting: (isSubmitting: boolean) => void,
  // Runs once a submission is resolved (by any path — real success, offline queue, or a
  // 409 that turns out to be an earlier attempt's success) but BEFORE the draft is
  // cleared, so a phase-specific carry-forward write (departure's seal, unloading's
  // visual count) still has the just-captured evidence to read from.
  onResolved: (freshTrip: Trip | null, evidence: T) => void,
  // onComplete returns a Promise on the final step and nothing on the others. The union
  // is load-bearing, not cosmetic: SwipeToConfirm inspects the return value to decide
  // whether a submit is still in flight, and that is the only thing keeping the control
  // locked (and reading "Submitting…") across a multi-second photo upload.
): { draft: T; onUpdate: (patch: Partial<T>) => void; onComplete: () => void | Promise<void> } {
  const router = useRouter()
  const { notify } = useToast()
  const { enqueuePhase } = useOfflineQueue()
  const { refetchTrip } = useTrip()
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
  // (lib/hooks/useOfflineQueue.ts). Every path out of a RESOLVED submission navigates
  // away, unmounting this hook instance for good, so a fresh key is only ever needed for
  // a genuinely new attempt — which naturally gets one, from a fresh mount.
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
        ? `Saved ${savedAt} — evidence recorded and anchored to Hedera HCS.`
        : notice === 'anchoring'
          ? `Saved ${savedAt} — evidence recorded — Hedera anchoring in progress. Track it on your trip screen.`
          : `Saved ${savedAt} — evidence stored on this device.`
    notify({ kind: 'success', title: `${PHASE_NAMES[phase.phase_type]} recorded`, body })
  }

  function notifyTripOnHold() {
    notify({
      kind: 'error',
      title: 'Trip on hold',
      body: 'A critical exception was recorded. The trip is paused for dispatcher review.',
    })
  }

  function advance() {
    router.push(nextStepRoute(trip.phases, phase, slug))
  }

  async function submitAndAdvance() {
    setIsSubmitting(true)
    if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = crypto.randomUUID()
    const evidence = draftRef.current

    try {
      const result = await submitPhase(tripId, phase.phase_event_id, phase.phase_type, evidence, idempotencyKeyRef.current)
      const addressedPhase = result.trip?.phases.find((p) => p.phase_event_id === phase.phase_event_id) ?? null
      onResolved(result.trip, evidence)
      clearDraft()
      // submitPhase's own return already has the fresh plan, but that's local to this
      // call — TripContext's own `trip` (what the NEXT step page's guard reads via
      // currentPhase(trip.phases)) is a separate cache that only refetchTrip() updates.
      // Without this, advance() below still computes the right URL (nextStepRoute only
      // depends on phases strictly AFTER this one, which this submission never changes),
      // but the page that URL lands on would see THIS phase as still unresolved in its
      // stale trip and immediately redirect back. Awaited before navigating so the next
      // page's first render already has fresh data. May transiently return null (the
      // trip just closed, e.g. confirmation's last step) — the top-level gate's Fix 2
      // (isSubmitting + lastTripRef) is what keeps this screen from flashing "Trip not
      // found" during that window.
      await refetchTrip()
      if (result.trip?.status === 'exception_hold') {
        notifyTripOnHold()
        router.push(ROUTES.activeTripDetail)
        return
      }
      notifyPhaseRecorded(recordedNotice(addressedPhase))
      advance()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // No ordinal TripStatus left to compare against — the parent plan collapsed it
        // to a coarse five (created | active | closed | cancelled | exception_hold),
        // and `active` covers the whole multi-stop middle. A duplicate submit of an
        // already-resolved phase also 409s, so the only way to tell "this already
        // succeeded" apart from a genuine conflict is to refetch and read the ADDRESSED
        // PHASE'S OWN status off the returned plan.
        const fetched = await refetchTrip()
        if (fetched?.status === 'exception_hold') {
          notifyTripOnHold()
          router.push(ROUTES.activeTripDetail)
          return
        }
        const addressedPhase = fetched?.phases.find((p) => p.phase_event_id === phase.phase_event_id) ?? null
        // Mirrors lib/phase/derive.ts's RESOLVED_STATUSES (not exported from that
        // module): completed, exception, and overridden all mean this row is done and
        // won't be revisited — only pending/in_progress means a genuinely fresh attempt
        // could still land.
        const alreadyResolved =
          addressedPhase !== null && addressedPhase.status !== 'pending' && addressedPhase.status !== 'in_progress'
        if (alreadyResolved) {
          onResolved(fetched, evidence)
          clearDraft()
          notifyPhaseRecorded(recordedNotice(addressedPhase))
          advance()
          return
        }
        setIsSubmitting(false)
        // The server's own 409 detail, not a hardcoded sentence. Every 409 the backend
        // raises writes a message describing its actual cause — an unresolved earlier
        // phase, or (PhaseTooEarlyError) a trip that isn't due until a stated date. The
        // fixed "trip state changed unexpectedly" text discarded all of that and told a
        // driver looking at a next-week trip something that wasn't true.
        notify({
          kind: 'error',
          title: 'Could not confirm phase',
          body: err.message || 'Trip state changed unexpectedly. Please retry from the trip screen.',
        })
        return
      }
      if (isQueueableFailure(err)) {
        // Network error or 5xx — queue for retry once connectivity/the server recovers.
        // Always 'plain', regardless of whether this phase is normally anchored: the
        // evidence hasn't reached the backend (or Hedera) yet, so claiming "anchoring in
        // progress" here would be dishonest.
        enqueuePhase(tripId, phase.phase_event_id, phase.phase_type, evidence)
        onResolved(null, evidence)
        clearDraft()
        notifyPhaseRecorded('plain')
        // Deliberately NOT advance(): nothing reached the backend, so TripContext's
        // cached trip.phases still shows THIS phase as unresolved — a future page's
        // mismatch guard would immediately bounce the driver right back here, onto a
        // now-blank draft (clearDraft() already ran). The trip hub is the honest
        // landing spot: it isn't gated on ledger position the way a phase step page is,
        // and it's where OfflineBanner's queued-evidence indicator already lives.
        router.push(ROUTES.activeTripDetail)
        return
      }
      // Terminal failure — either a client-side 4xx, or a local validation Error thrown
      // by submitPhase before any network call. Neither can ever succeed on retry, so
      // queuing it would be dishonest. Leave the driver on this screen with their draft
      // intact so they can fix and retry.
      setIsSubmitting(false)
      const message = err instanceof Error ? err.message : 'Could not submit. Please try again.'
      notify({ kind: 'error', title: 'Could not submit', body: message })
    }
  }

  // Returns submitAndAdvance's promise rather than discarding it with `void`. Discarding
  // it meant the swipe control never learned a submit was running: it re-enabled itself
  // ~180ms after the gesture, mid-upload, so the driver got a live track back while the
  // request was still in flight and could fire a second submit into it.
  const onComplete = isFinalStep ? submitAndAdvance : advance

  return { draft, onUpdate, onComplete }
}

function ActivationStep({ trip, phase, slug, stepIndex, isFinalStep, setIsSubmitting }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete } = usePhaseStepController<ActivationEvidence>(
    trip, phase, slug, isFinalStep, ACTIVATION_INITIAL, setIsSubmitting, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

function LoadingStep({ trip, phase, slug, stepIndex, isFinalStep, setIsSubmitting }: StepControllerProps) {
  const tripId = String(trip.id)
  const { draft, onUpdate, onComplete } = usePhaseStepController<LoadingEvidence>(
    trip, phase, slug, isFinalStep, LOADING_INITIAL, setIsSubmitting, () => {},
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

function DepartureStep({ trip, phase, slug, stepIndex, isFinalStep, setIsSubmitting }: StepControllerProps) {
  const tripId = String(trip.id)
  // Durable per-trip reference the seal committed here needs to survive into
  // `unloading`'s reference display (see UnloadingStep below) — this phase's own draft
  // is cleared the moment it submits successfully.
  const [, setSealReference] = useSealReference(tripId)
  const { draft, onUpdate, onComplete } = usePhaseStepController<DepartureEvidence>(
    trip, phase, slug, isFinalStep, DEPARTURE_INITIAL, setIsSubmitting,
    (_freshTrip, evidence) => setSealReference(evidence.sealNumber),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

// The seal-verify step's slug — referenced by name (not position) so this branch reads
// as "the step that needs the reference seal", matching how components/phase/steps/
// unloading/SealVerify.tsx itself is keyed in STEP_REGISTRY.
const UNLOADING_SEAL_VERIFY_SLUG = '2-seal-verify'

function UnloadingStep({ trip, phase, slug, stepIndex, isFinalStep, setIsSubmitting }: StepControllerProps) {
  const tripId = String(trip.id)
  const [sealReference, , clearSealReference] = useSealReference(tripId)
  const [, setVisualCountCarry] = useVisualCountCarry(tripId)
  const { draft, onUpdate, onComplete } = usePhaseStepController<UnloadingEvidence>(
    trip, phase, slug, isFinalStep, UNLOADING_INITIAL, setIsSubmitting,
    (_freshTrip, evidence) => {
      // The seal reference has no consumer after unloading (confirmation doesn't need
      // it) — torn down here, the same point the old model cleared it.
      clearSealReference()
      setVisualCountCarry(evidence.driverVisualCount)
    },
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  const extraProps = slug === UNLOADING_SEAL_VERIFY_SLUG ? { referenceSealNumber: sealReference } : {}
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete, ...extraProps })
}

function ConfirmationStep({ trip, phase, slug, stepIndex, isFinalStep, setIsSubmitting }: StepControllerProps) {
  const tripId = String(trip.id)
  const [carriedVisualCount, , clearVisualCountCarry] = useVisualCountCarry(tripId)
  const initial: ConfirmationEvidence = { ...CONFIRMATION_INITIAL_BASE, driverVisualCount: carriedVisualCount }
  const { draft, onUpdate, onComplete } = usePhaseStepController<ConfirmationEvidence>(
    trip, phase, slug, isFinalStep, initial, setIsSubmitting,
    () => clearVisualCountCarry(),
  )
  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate, onComplete })
}

function InTransitStep({ trip, phase, slug, stepIndex }: StepControllerProps) {
  const router = useRouter()
  const tripId = String(trip.id)
  const [draft, updateDraft, clearDraft] = usePhaseDraft<ArrivalDraft>(tripId, phase.phase_event_id, ARRIVAL_INITIAL)

  function advance() {
    // in_transit has no PhaseCompleteRequest variant server-side — lib/api/phases.ts's
    // submitPhase throws if it's ever addressed directly, because this phase is
    // auto-completed by advance_departure's stopgap (parent plan D13) before the driver
    // reaches it in practice. If it's ever reached anyway, there is nothing to submit:
    // clear the local draft and walk forward exactly like a mid-phase step would.
    clearDraft()
    router.push(nextStepRoute(trip.phases, phase, slug))
  }

  const StepComponent = stepComponentFor(phase.phase_type, slug)
  if (!StepComponent) return <UnknownStep phaseType={phase.phase_type} slug={slug} />
  return renderStep(StepComponent, { tripId, phase, stepIndex, draft, onUpdate: updateDraft, onComplete: advance })
}
