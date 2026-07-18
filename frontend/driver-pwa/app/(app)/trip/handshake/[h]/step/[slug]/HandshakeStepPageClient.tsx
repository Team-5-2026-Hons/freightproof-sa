// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useHandshakeDraft } from '@/lib/hooks/useHandshakeDraft'
import { useSealReference } from '@/lib/hooks/useSealReference'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { submitHandshake } from '@/lib/api/handshakes'
import { ApiError } from '@/lib/api/client'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { nextHandshakeRoute } from '@/lib/navigation/handshake-flow'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { ROUTES } from '@/lib/constants/routes'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { HoldNotice } from '@/components/trip/HoldNotice'
import type { H1Evidence, H2Evidence, H3Evidence, H4Evidence, H5Evidence } from '@/lib/types/evidence-draft'
import type { Trip, TripStatus } from '@shared/lib/types/trip'
import { H1GateArrival } from '@/components/handshake/steps/H1GateArrival'
import { H1Verification } from '@/components/handshake/steps/H1Verification'
import { H2ArriveBay } from '@/components/handshake/steps/H2ArriveBay'
import { H2Linehaul } from '@/components/handshake/steps/H2Linehaul'
import { H2Waybill } from '@/components/handshake/steps/H2Waybill'
import { H2Seal } from '@/components/handshake/steps/H2Seal'
import { H2Review } from '@/components/handshake/steps/H2Review'
import { H3ApproachExit } from '@/components/handshake/steps/H3ApproachExit'
import { H3ExitSeal } from '@/components/handshake/steps/H3ExitSeal'
import { H3Departure } from '@/components/handshake/steps/H3Departure'
import { H4ApproachDest } from '@/components/handshake/steps/H4ApproachDest'
import { H4SealVerify } from '@/components/handshake/steps/H4SealVerify'
import { H5HandWaybill } from '@/components/handshake/steps/H5HandWaybill'
import { H5SealInspection } from '@/components/handshake/steps/H5SealInspection'
import { H5VisualCount } from '@/components/handshake/steps/H5VisualCount'
import { H5PodPhoto } from '@/components/handshake/steps/H5PodPhoto'
import { H5Reconciliation } from '@/components/handshake/steps/H5Reconciliation'
import { H5Closed } from '@/components/handshake/steps/H5Closed'

// gateAddress is a required field on H1Evidence (reverse-geocoded display value, display-only) —
// must be present here or this literal fails to satisfy H1Evidence.
const H1_INITIAL: H1Evidence = { gpsLat: null, gpsLng: null, gateAddress: null, capturedAt: null }
const H2_INITIAL: H2Evidence = { gpsLat: null, gpsLng: null, ppManifestParcelCount: null, driverVisualCount: null, waybillPhotoDataUrl: null, sealNumber: null, sealPhotoDataUrl: null, capturedAt: null }
const H3_INITIAL: H3Evidence = { gpsLat: null, gpsLng: null, sealNumberConfirmed: null, sealVerifiedMatch: null, capturedAt: null }
const H4_INITIAL: H4Evidence = { gpsLat: null, gpsLng: null, sealNumberAtDestination: null, sealVerifiedMatch: null, capturedAt: null }
const H5_INITIAL: H5Evidence = { waybillHandedOver: null, sealBrokenPhotoDataUrl: null, driverVisualCount: null, podPhotoDataUrl: null, podSignatureDataUrl: null, reconciliationNote: null, capturedAt: null }

type SubmittableHandshakeType = 'origin_gate_in' | 'loading' | 'origin_gate_out' | 'dest_gate_in' | 'unloading'

// The TripStatus a successful submission of each handshake type produces — used to tell a
// genuine 409 (driver tried to skip ahead / wrong state) apart from a 409 caused by a
// duplicate submit of a handshake that already succeeded on an earlier attempt.
const RESULT_STATUS: Record<SubmittableHandshakeType, TripStatus> = {
  origin_gate_in: 'origin_gate_in',
  loading: 'loading',
  origin_gate_out: 'origin_gate_out',
  dest_gate_in: 'dest_gate_in',
  unloading: 'unloading',
}

const STATUS_ORDER: TripStatus[] = [
  'created', 'origin_gate_in', 'loading', 'origin_gate_out',
  'in_transit', 'dest_gate_in', 'unloading', 'closed',
]

function isAtOrPast(status: TripStatus, target: TripStatus): boolean {
  return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(target)
}

// The backend only anchors H2 (loading) and H5 (unloading) to Hedera HCS — H1/H3/H4
// are unanchored "feeder" handshakes by design (see H1Verification's copy). Used to
// decide whether the completion receipt can honestly claim anchoring.
function isAnchoredHandshakeType(type: SubmittableHandshakeType): boolean {
  return type === 'loading' || type === 'unloading'
}

// Whether a submitAndAdvance failure is plausibly transient — worth queuing for retry
// once connectivity/the server recovers. A local validation Error thrown by
// submitHandshake BEFORE any network call (e.g. "H1 evidence incomplete — GPS and gate
// photo are required.") or a terminal 4xx can never succeed by simply retrying; queuing
// those would hand the driver a misleading "evidence stored on this device" receipt for
// evidence that was never actually valid. Exported (pure, no I/O) so it's unit-testable
// on its own without exercising the whole submit flow.
export function isQueueableFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status >= 500
  return err instanceof TypeError
}

// Thin gate: decides WHETHER the step screen renders at all, before any hook that
// depends on a real trip ever mounts. See the Fix 1 comment below — this split exists
// specifically so useHandshakeDraft/useSealReference (owned by HandshakeStepContent)
// can never mount with an empty tripId.
export default function HandshakeStepPageClient() {
  const router = useRouter()
  const { trip, isLoading } = useTrip()

  // Fix 2 (submit-triggered spinner/"not found" flash): tracks whether a handshake
  // submit (submitAndAdvance, defined in HandshakeStepContent) is currently in flight.
  // submitAndAdvance awaits refetchTrip(), which toggles TripContext's SHARED isLoading
  // — without this flag, every H1–H5 submit would replace the step UI (including
  // HoldButton's own "Submitting…" progress state) with a full-screen spinner flash for
  // however long the refetch takes. It is only ever reset back to false on the branches
  // where the driver stays on THIS screen (see submitAndAdvance) — every success path
  // navigates to a different top-level route (ROUTES.activeTripDetail / inTransit /
  // trips — see nextHandshakeRoute), so this whole component unmounts and discards the
  // flag naturally. Resetting it eagerly on those paths would race the very render this
  // flag exists to cover (see lastTripRef below) — a batched setTrip(null) landing in
  // the same commit as setIsSubmitting(false) would flash "Trip not found" anyway.
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fix 2 (H5 case): once H5 (unloading) submits, refetchTrip() legitimately returns
  // null — the trip just closed, so GET /trips/me/active has nothing left to return —
  // while the success toast fires and advance() navigates to ROUTES.trips. Without a
  // fallback, the render in that window falls into the `!trip` branch and flashes
  // "Trip not found" before the navigation actually takes effect. Caching the last
  // known non-null trip lets the step UI (H5Closed) stay on screen for that window
  // instead — the component navigates away moments later regardless. The ref is
  // written in an effect (post-commit), never during render: a render-time write is
  // unsafe under React 19 concurrent rendering (react-hooks v6's refs rule rejects
  // it), and the setState-during-render alternative loops whenever useTrip() yields
  // a fresh object identity per call. Post-commit timing is sufficient — the
  // fallback is only ever read mid-submit, long after the trip-bearing render
  // committed.
  const lastTripRef = useRef<Trip | null>(null)
  useEffect(() => {
    if (trip) lastTripRef.current = trip
  }, [trip])

  // Fix 1 (CRITICAL evidence-wipe bug): the (app) layout only gates children on auth,
  // not on TripContext.isLoading — so a hard reload, PWA relaunch, or a
  // push-notification deep link straight into a handshake step can mount this page
  // while `trip` is still null. useHandshakeDraft/useSealReference key their
  // localStorage reads off tripId inside a useState LAZY initializer that only ever
  // runs on first mount — if they mounted with tripId = '' before the trip loaded,
  // they'd read the WRONG storage keys, start empty, and then the driver's very next
  // updateDraft() call would overwrite the CORRECT (real-tripId) key with that empty
  // state — permanently erasing any previously captured photos/GPS/seal evidence. The
  // fix: HandshakeStepContent (the only thing that calls those hooks) never mounts
  // until `trip` is a real, non-null object, so their first mount always sees the real
  // tripId.
  if (isLoading && !isSubmitting) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Spinner />
      </main>
    )
  }

  const activeTrip = trip ?? (isSubmitting ? lastTripRef.current : null)

  if (!activeTrip) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-surface-on-variant">Trip not found.</p>
      </main>
    )
  }

  // Blocks every step screen (including deep links) while the trip is held — any
  // handshake submit in this state can only 409, so there's nothing to do here.
  if (activeTrip.status === 'exception_hold') {
    return (
      <main className="flex min-h-screen flex-col justify-center gap-4 p-6">
        <HoldNotice />
        <Button variant="secondary" size="lg" onClick={() => router.push(ROUTES.activeTripDetail)}>
          View trip
        </Button>
      </main>
    )
  }

  return (
    <HandshakeStepContent trip={activeTrip} setIsSubmitting={setIsSubmitting} />
  )
}

interface HandshakeStepContentProps {
  trip: Trip
  setIsSubmitting: (isSubmitting: boolean) => void
}

// Everything that actually needs a real, non-null trip lives here — most importantly
// useHandshakeDraft/useSealReference (see Fix 1 above). `trip` arriving as a required
// prop rather than being read from useTrip() directly is what makes those hooks safe:
// this component simply doesn't exist until the gate above has one to hand it.
function HandshakeStepContent({ trip, setIsSubmitting }: HandshakeStepContentProps) {
  const { h, slug } = useParams<{ h: string; slug: string }>()
  const router = useRouter()
  const { enqueue } = useOfflineQueue()
  const { refetchTrip } = useTrip()
  const { notify } = useToast()

  const handshakeNum = Number(h) as 1 | 2 | 3 | 4 | 5

  // URL-derived navigation (single source of truth) — see lib/navigation/handshake-flow.ts.
  // The backend stays authoritative for whether the handshake is valid; this only moves
  // the driver to the next screen. Driving flow from the URL (not TripContext's internal
  // counter) means a refresh or deep-link can never land on the wrong step.
  const advance = useCallback(
    () => router.push(nextHandshakeRoute(handshakeNum, slug)),
    [router, handshakeNum, slug],
  )

  // The trip comes from the driver's session (TripContext), not the URL — the backend
  // enforces one active trip per driver, so there's nothing left to verify it against.
  // `trip` is a required prop here (never null) — see the gate in
  // HandshakeStepPageClient, which is what guarantees these hooks below always key off
  // the real tripId on their first mount.
  const tripId = String(trip.id)

  const [h1Draft, updateH1, clearH1] = useHandshakeDraft<H1Evidence>(tripId, 'origin_gate_in', H1_INITIAL)
  const [h2Draft, updateH2, clearH2] = useHandshakeDraft<H2Evidence>(tripId, 'loading', H2_INITIAL)
  const [h3Draft, updateH3, clearH3] = useHandshakeDraft<H3Evidence>(tripId, 'origin_gate_out', H3_INITIAL)
  const [h4Draft, updateH4, clearH4] = useHandshakeDraft<H4Evidence>(tripId, 'dest_gate_in', H4_INITIAL)
  const [h5Draft, updateH5, clearH5] = useHandshakeDraft<H5Evidence>(tripId, 'unloading', H5_INITIAL)

  // Durable per-trip reference to the seal set at loading — outlives h2Draft, which
  // submitAndAdvance clears the moment H2 submits successfully. H3/H4 read this (falling
  // back to h2Draft.sealNumber for the in-H2 case, e.g. before H2 has been submitted).
  const [sealReference, setSealReference, clearSealReference] = useSealReference(tripId)
  const h2SealNumber = sealReference ?? h2Draft.sealNumber

  // Three receipt copies, from most to least specific: a real anchored handshake with
  // its Hedera receipt back, a real anchored handshake still waiting on that receipt
  // (anchor-before-status-flip means this should be rare, but the backend hasn't
  // guaranteed synchronous confirmation, so claiming "anchored" here would be
  // dishonest), and the plain "recorded" copy for demo mode / unanchored H1/H3/H4 /
  // the offline-queue path (evidence never reached the backend at all yet).
  type RecordedNotice = 'anchored' | 'anchoring' | 'plain'

  // Whether a just-completed real submit's evidence actually has its Hedera receipt
  // back yet — checked against the freshest Trip in hand. Prefer the trip returned by
  // the complete call itself: after H5 the trip is CLOSED, so refetchTrip() (which
  // reads /trips/me/active) returns null and could never confirm the anchor. Demo mode
  // and non-anchored handshake types never anchor at all, so they short-circuit to
  // 'plain' without needing a Trip.
  function recordedNotice(type: SubmittableHandshakeType, freshTrip: Trip | null): RecordedNotice {
    if (IS_DEMO_MODE || !isAnchoredHandshakeType(type)) return 'plain'
    const handshake = freshTrip?.handshakes.find((hs) => hs.sequence_number === handshakeNum)
    return handshake?.blockchain_receipt_id ? 'anchored' : 'anchoring'
  }

  // Completion receipt (UX Task 5a): every exit from submitAndAdvance that means "your
  // evidence is safely captured" fires this before the redirect — without it the driver
  // lands back on the trip page with zero confirmation, the biggest trust gap found in
  // the UX walkthrough.
  function notifyHandshakeRecorded(notice: RecordedNotice) {
    const savedAt = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
    const body =
      notice === 'anchored'
        ? `Saved ${savedAt} — evidence recorded and anchored to Hedera HCS.`
        : notice === 'anchoring'
          ? `Saved ${savedAt} — evidence recorded — Hedera anchoring in progress. Track it on your trip screen.`
          : `Saved ${savedAt} — evidence stored on this device.`
    notify({ kind: 'success', title: `${HANDSHAKE_NAMES[handshakeNum]} recorded`, body })
  }

  // Fired when a submit lands but the backend put the trip on exception hold (H4 seal
  // mismatch). The evidence WAS recorded — but advancing to the next handshake would
  // only 409; the driver needs to know the trip is paused, not see a success receipt.
  function notifyTripOnHold() {
    notify({
      kind: 'error',
      title: 'Seal mismatch recorded',
      body: 'The destination seal does not match the seal set at loading. The trip is on hold for dispatcher review.',
    })
  }

  // Runs immediately before a handshake's draft is cleared on every success path. H2
  // (loading) sets the durable seal reference here — BEFORE clearFn() runs — so H3/H4
  // still have something to compare against once h2Draft is gone. H5 (unloading) is the
  // trip closing, so the reference is torn down here rather than living on for a future trip.
  function syncSealReference(type: SubmittableHandshakeType, evidence: H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence) {
    if (type === 'loading') setSealReference((evidence as H2Evidence).sealNumber)
    if (type === 'unloading') clearSealReference()
  }

  async function submitAndAdvance(
    type: SubmittableHandshakeType,
    evidence: H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence,
    clearFn: () => void,
  ) {
    // Fix 2: flips on for the whole submit. Every success/queue path below navigates to
    // a different top-level route and never resets this back to false itself — the
    // component unmounts on the way there, discarding it for free. Only the two
    // stay-on-this-screen failure branches reset it explicitly, since the driver can
    // retry from here and a later isLoading toggle should show the spinner normally.
    setIsSubmitting(true)
    try {
      const submitted = await submitHandshake(tripId, type, evidence)
      const fresh = await refetchTrip()
      syncSealReference(type, evidence)
      clearFn()
      if ((submitted.trip ?? fresh)?.status === 'exception_hold') {
        notifyTripOnHold()
        router.push(ROUTES.activeTripDetail)
        return
      }
      notifyHandshakeRecorded(recordedNotice(type, submitted.trip ?? fresh))
      advance()
      return
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // A duplicate submit of a handshake that already succeeded on an earlier attempt
        // also gets a 409 (trip is no longer in the expected pre-state) — refetch and check
        // whether that's what happened before treating this as a real failure.
        const fetched = await refetchTrip()
        if (fetched?.status === 'exception_hold') {
          // e.g. the driver reached H5 before the app learned about an H4 hold — nothing
          // here is retryable, so route to the trip screen where HoldNotice explains.
          notifyTripOnHold()
          router.push(ROUTES.activeTripDetail)
          return
        }
        if (fetched && isAtOrPast(fetched.status, RESULT_STATUS[type])) {
          syncSealReference(type, evidence)
          clearFn()
          // The earlier attempt did record the evidence — the driver still deserves the receipt.
          notifyHandshakeRecorded(recordedNotice(type, fetched))
          advance()
          return
        }
        // Staying on this exact screen — a genuinely fresh attempt can happen next, so
        // a later isLoading toggle should show the spinner as normal again.
        setIsSubmitting(false)
        notify({
          kind: 'error',
          title: 'Could not confirm handshake',
          body: 'Trip state changed unexpectedly. Please retry from the trip screen.',
        })
        return
      }
      if (isQueueableFailure(err)) {
        // Network error or 5xx — queue for retry once connectivity/the server recovers.
        // The receipt's "stored on this device" wording is literally true here: the
        // evidence sits in the offline queue until it syncs — always 'plain', even for
        // H2/H5, since it hasn't reached the backend (or Hedera) yet.
        enqueue(tripId, type, evidence)
        syncSealReference(type, evidence)
        clearFn()
        notifyHandshakeRecorded('plain')
        advance()
        return
      }
      // Terminal failure — either a client-side 4xx, or a local validation Error thrown
      // by submitHandshake before any network call. Neither can ever succeed on retry,
      // so queuing it would be dishonest. Leave the driver on this screen with their
      // draft intact so they can fix and retry — and since they're staying here, a
      // later isLoading toggle should behave normally again.
      setIsSubmitting(false)
      const message = err instanceof Error ? err.message : 'Could not submit. Please try again.'
      notify({ kind: 'error', title: 'Could not submit', body: message })
    }
  }

  const props = { tripId }

  if (handshakeNum === 1) {
    if (slug === '1-approach-gate') return <H1GateArrival {...props} draft={h1Draft} onUpdate={updateH1} onComplete={advance} />
    if (slug === '2-verification')  return <H1Verification {...props} draft={h1Draft} onComplete={() => submitAndAdvance('origin_gate_in', h1Draft, clearH1)} />
  }

  if (handshakeNum === 2) {
    if (slug === '1-arrive-bay') return <H2ArriveBay {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '2-linehaul')   return <H2Linehaul  {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '3-waybill')    return <H2Waybill   {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '4-seal')       return <H2Seal      {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '5-review')     return <H2Review    {...props} draft={h2Draft} onComplete={() => submitAndAdvance('loading', h2Draft, clearH2)} />
  }

  if (handshakeNum === 3) {
    if (slug === '1-approach-exit')  return <H3ApproachExit {...props} draft={h3Draft} onUpdate={updateH3} onComplete={advance} />
    if (slug === '2-exit-and-seal')  return <H3ExitSeal     {...props} draft={h3Draft} h2SealNumber={h2SealNumber} onUpdate={updateH3} onComplete={advance} />
    if (slug === '3-departure')      return <H3Departure    {...props} draft={h3Draft} onComplete={() => submitAndAdvance('origin_gate_out', h3Draft, clearH3)} />
  }

  if (handshakeNum === 4) {
    if (slug === '1-approach-dest') return <H4ApproachDest {...props} draft={h4Draft} onUpdate={updateH4} onComplete={advance} />
    if (slug === '2-seal-verify')   return <H4SealVerify   {...props} draft={h4Draft} h2SealNumber={h2SealNumber} onUpdate={updateH4} onComplete={() => submitAndAdvance('dest_gate_in', h4Draft, clearH4)} />
  }

  if (handshakeNum === 5) {
    if (slug === '1-hand-waybill')        return <H5HandWaybill    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '2-seal-break-inspection') return <H5SealInspection {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '3-visual-count')        return <H5VisualCount    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} h2Count={h2Draft.driverVisualCount} />
    if (slug === '4-pod-photo')           return <H5PodPhoto       {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '5-reconciliation')      return <H5Reconciliation {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '6-closed')              return <H5Closed         {...props} draft={h5Draft} onComplete={() => submitAndAdvance('unloading', h5Draft, clearH5)} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-error">Unknown step: H{handshakeNum}/{slug}</p>
    </main>
  )
}
