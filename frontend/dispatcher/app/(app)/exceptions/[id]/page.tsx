'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { BackButton } from '@/components/ui/BackButton'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { Spinner }    from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  CONTACT_METHOD_LABELS, NO_CONTACT_CHOSEN, NO_OUTCOME_CHOSEN,
  REVIEW_OUTCOME_LABELS, ReviewFields,
} from '@/components/domain/ReviewFields'
import { ExceptionDetailEvidence } from '@/components/exceptions/ExceptionDetailEvidence'
import { GPS_MISMATCH_TRIGGER } from '@/components/domain/PositionDisagreement'
import { ApiError, claimException, releaseException, reviewException } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { reviewState } from '@/lib/format/review-state'
import { useToast } from '@/lib/hooks/useToast'
import { useExceptionDetail } from '@/lib/hooks/useExceptionDetail'
import { fmtBreakdownVehicle, fmtExceptionType, fmtExceptionRaised, fmtExceptionPhaseStop, fmtExceptionRoute } from '@/lib/format/exception'
import type {
  DispatcherReviewOutcome,
  ExceptionContactMethod,
  ExceptionType,
} from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META, TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/navigation/returnTo'
import { fmtDateTime } from '@shared/lib/utils/datetime'

// The one exception type that records which vehicle it happened to (trailer analytics).
// Any other type showing a Vehicle row would read "Not recorded" for no reason.
const BREAKDOWN_TYPE: ExceptionType = 'mechanical'

// A 409 can now mean either a colleague's claim or a colleague's review, so one title
// serves the claim, take-over and review handlers alike.
const CONFLICT_TOAST_TITLE = 'A colleague got there first'
const TAKE_OVER_LABEL = 'Take over'
const TAKE_OVER_AND_REVIEW_LABEL = 'Take over and review'
const ASSESSMENT_SCROLL_GUTTER_PX = 32

// Explanatory, non-blocking copy for a trip whose lifecycle has already moved past
// "active", reviewing is evidence handling, never trip lifecycle control (see
// review_exception's own backend docstring), so this never gates the form below; it
// only exists so a dispatcher reviewing a critical exception on an ended trip is never
// confused into thinking their review reopens or changes that trip. null for the
// statuses that need no such reassurance.
function tripLifecycleNotice(status: TripStatus): string | null {
  switch (status) {
    case 'closed':         return 'Trip closed. Reviewing this exception does not reopen the trip.'
    case 'cancelled':       return 'Trip cancelled. Reviewing this exception does not change the trip.'
    case 'exception_hold':  return 'Trip on exception hold. Reviewing this exception does not clear the hold.'
    default:                 return null
  }
}

function ContextItem({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return <div className={`min-w-0 ${className}`}>
    <dt className="text-[10px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-on-surf">{value}</dd>
  </div>
}

export default function ExceptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const search = useSearchParams()
  // An exception is opened from its own list or from the trip whose timeline records it.
  // ExceptionSummary has always appended this parameter; nothing read it until now, so
  // reviewing an exception reached from a trip still ejected the reader to the list.
  const backTo = safeReturnTo(search.get(RETURN_TO_PARAM), ROUTES.exceptions)
  const { notify } = useToast()

  const { user } = useAuth()
  const meId = user?.id ?? null

  const exceptionId = params.id as string
  const { exception, isLoading, error, refetch, refetchSilent } = useExceptionDetail(exceptionId)

  // Only meaningful for a legacy 'recorded' row, the FP-280 backfill moved every such
  // row to needs_review, but the status still exists, so the page keeps handling it. A
  // 'needs_review' exception shows the form regardless of this flag (see the JSX below).
  const [showReviewForm, setShowReviewForm] = useState(false)

  const [reviewNote, setReviewNote]         = useState('')
  const [reviewOutcome, setReviewOutcome]   =
    useState<DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN>(NO_OUTCOME_CHOSEN)
  const [contactMethod, setContactMethod]   =
    useState<ExceptionContactMethod | typeof NO_CONTACT_CHOSEN>(NO_CONTACT_CHOSEN)
  const [reviewing, setReviewing]           = useState(false)
  const [claimBusy, setClaimBusy]            = useState(false)

  // Built once and passed to TopBar's `left` slot in every state (loading, error,
  // success), matching the precinct/driver/vehicle detail pages: back navigation always
  // sits top-left, and a header that only gains Back once data resolves reads as broken.
  const assessmentHeading = useRef<HTMLHeadingElement>(null)
  const assessmentPanel = useRef<HTMLElement>(null)
  const detailScroller = useRef<HTMLDivElement>(null)
  const [assessmentFits, setAssessmentFits] = useState(false)
  useEffect(() => {
    if (!assessmentPanel.current || !detailScroller.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const panel = assessmentPanel.current, scroller = detailScroller.current
      if (panel && scroller) setAssessmentFits(panel.offsetHeight + ASSESSMENT_SCROLL_GUTTER_PX <= scroller.clientHeight)
    })
    observer.observe(assessmentPanel.current); observer.observe(detailScroller.current)
    return () => observer.disconnect()
  }, [exception?.id, exception?.review_status])
  const draftActive = exception?.review_status !== 'reviewed' && !!(reviewNote || reviewOutcome || contactMethod)
  useEffect(() => {
    if (!draftActive) return
    function beforeUnload(event: BeforeUnloadEvent): void { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [draftActive])
  function navigate(target: string): void {
    if (draftActive && !window.confirm('Leave without submitting this assessment?')) return
    router.push(target)
  }
  const backButton = <BackButton onClick={() => navigate(backTo)} />

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail" left={backButton} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  // ── Could not load ───────────────────────────────────────────────────────────
  // useExceptionDetail fetches this one record directly by id, there is no client-side
  // list search left to distinguish "genuinely not found" from "some other fetch
  // failure", so `!exception` is the one honest condition covering both. A BACKGROUND
  // refresh failure (the hook refetches on exception_raised/exception_reviewed events
  // for this trip) must never reach this branch while a record is already on screen -
  // without the `!exception` gate, one failed background refresh would tear down this
  // page mid-use, taking a half-typed review with it and destroying a half-typed
  // account of a live incident. If the exception is already in hand, the page stays up
  // and a stale read is strictly better than a lost note.
  if (!exception) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail" left={backButton} />
        <div className="flex-1 overflow-auto p-6">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-err" />}
            title="Could not load this exception"
            body={error ?? COPY.errors.notFound}
            cta={<Button onClick={() => router.push(ROUTES.exceptions)}>Back to Exceptions</Button>}
          />
        </div>
      </div>
    )
  }

  const sevMeta    = EXCEPTION_SEVERITY_META[exception.severity]
  const srcMeta    = EXCEPTION_SOURCE_META[exception.source]
  const tripMeta   = TRIP_STATUS_META[exception.trip_status]
  const phaseStop  = fmtExceptionPhaseStop(exception.phase_label, exception.stop_label)
  const lifecycleNotice = tripLifecycleNotice(exception.trip_status)

  const isReviewed   = exception.review_status === 'reviewed'
  const needsReview  = exception.review_status === 'needs_review'
  const showForm     = needsReview || showReviewForm
  const rState       = reviewState(exception, meId)
  const claimedByOther = rState.kind === 'claimed_by_other'
  // Reviewing over a colleague's claim is an explicit act, stated on the button itself
  // (D5), so the server can tell it from a stale page and never silently overrides.
  const submitLabel  = claimedByOther ? TAKE_OVER_AND_REVIEW_LABEL : COPY.actions.submitReview
  const claimedLine  = exception.claimed_by_user_id !== null
    ? `${rState.kind === 'claimed_by_me' ? 'Claimed by you' : `Claimed by ${exception.claimed_by_name ?? 'a colleague'}`}${
        exception.claimed_at ? ` · ${fmtDateTime(exception.claimed_at)}` : ''}`
    : null
  // Shown on a reviewed row only when the claimer and reviewer are different people, so
  // the record says who was working it as well as who closed it.
  const showClaimerOnReviewed =
    exception.claimed_by_user_id !== null
    && exception.claimed_by_user_id !== exception.reviewed_by_user_id

  // One handler for claim, take-over and release. The mutation responses carry no
  // reviewer names, so the page always refetches (which does) instead of trusting them.
  const runClaimAction = async (
    action: () => Promise<unknown>,
    successTitle: string,
    failureTitle: string,
  ) => {
    setClaimBusy(true)
    try {
      await action()
      notify({ kind: 'success', title: successTitle })
      refetchSilent()
    } catch (err) {
      const lostTheRace = err instanceof ApiError && err.status === 409
      notify({
        kind: 'error',
        title: lostTheRace ? CONFLICT_TOAST_TITLE : failureTitle,
        body: err instanceof Error ? err.message : 'Please try again.',
      })
      // Our copy of the claim is stale; show the colleague's now-visible claim.
      if (lostTheRace) refetchSilent()
    } finally {
      setClaimBusy(false)
    }
  }
  const handleClaim    = () => runClaimAction(() => claimException(exceptionId), 'Exception claimed.', 'Could not claim this exception')
  const handleTakeOver = () => runClaimAction(() => claimException(exceptionId, true), 'You took over this exception.', 'Could not take over this exception')
  const handleRelease  = () => runClaimAction(() => releaseException(exceptionId), 'Claim released.', 'Could not release this exception')

  const handleReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedNote = reviewNote.trim()
    // Both gates, not just the disabled attribute, a form can still be submitted by
    // keyboard, and neither field may reach the API unset. Contact method is exempt: it
    // is optional by design, so it never belongs in this gate.
    if (!trimmedNote || reviewOutcome === NO_OUTCOME_CHOSEN || reviewing) return
    setReviewing(true)
    try {
      await reviewException(exceptionId, {
        review_note: trimmedNote,
        review_outcome: reviewOutcome,
        // Explicit null, not an omitted key, the backend requires the key present so
        // it can tell "no contact happened" apart from a client that forgot the field.
        contact_method: contactMethod || null,
        // Omitted (not false) unless taking over, so an ordinary review body is unchanged.
        ...(claimedByOther ? { take_over: true } : {}),
      })
      notify({ kind: 'success', title: COPY.toast.exceptionReviewed })
      // No refetch before navigating: this hook instance dies with the page, and
      // useAsyncData's mountedRef discards a result that lands after unmount. Whichever
      // screen receives us mounts its own hook and fetches on mount, the trip detail
      // page may paint a cached copy first, but it always revalidates, so a review made
      // here cannot leave a stale review status on screen.
      router.push(backTo)
    } catch (err) {
      // Surfaced, never swallowed, the old resolve flow's bug was a fake unconditional
      // success toast that reported reviews which had never been recorded.
      const lostTheRace = err instanceof ApiError && err.status === 409
      notify({
        kind: 'error',
        title: lostTheRace ? CONFLICT_TOAST_TITLE : 'Could not review this exception',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
      // Deliberately stay on the page and refetch rather than navigating away. Their
      // note is still in the form; the silent refetch shows the colleague's claim (the
      // submit then reads "Take over and review") or their completed review, so they can
      // read what was established instead of being bounced to a list.
      if (lostTheRace) refetchSilent()
      setReviewing(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={fmtExceptionType(exception.exception_type)} left={backButton} />
      <div ref={detailScroller} className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 py-6">
          {error && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-c px-4 py-3 text-sm text-warn-onc">
            This record may be out of date, the last refresh failed.<Button variant="ghost" onClick={refetchSilent}>Retry</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <Chip type={sevMeta.chipType} label={sevMeta.label} />
            <span className="text-sm text-on-surf-v">{needsReview ? 'Needs review' : isReviewed ? 'Reviewed' : 'Recorded'}</span>
          </div>
          {/* One grid so the assessment can span the full height of the left column. Stacked
              (narrow) the DOM order is context, incident, assessment, evidence, so the task
              always comes before the long evidence; from xl it sits top-right beside all three. */}
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_auto_1fr] xl:gap-x-6">
          <section aria-label="Trip context" className="xl:col-start-1 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all text-sm font-semibold tabular-nums text-on-surf">Trip {exception.trip_reference}</p>
                <p className="mt-0.5 text-xs text-on-surf-v">{tripMeta.label}{phaseStop ? ` · ${phaseStop}` : ''}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => navigate(ROUTES.tripDetail(exception.trip_id))}>View trip <Ic n="chev" s={14} /></Button>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-outline-v/20 pt-4 sm:grid-cols-3">
              <ContextItem label="Route" className="sm:col-span-3" value={fmtExceptionRoute(exception.origin_name, exception.destination_name)} />
              <ContextItem label="Driver" value={exception.driver_name ?? 'Not recorded'} />
              <ContextItem label="Truck" value={exception.horse_registration ?? 'Not recorded'} />
              <ContextItem label="Trailers" value={exception.trailer_registrations.length ? exception.trailer_registrations.join(', ') : 'None attached'} />
            </dl>
            <p className="mt-4 border-t border-outline-v/20 pt-3 text-xs tabular-nums text-on-surf-v">{srcMeta.label} · Raised {fmtExceptionRaised(exception.created_at)}</p>
          </section>
          <section className="xl:col-start-1 min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6" aria-label="Incident">
            <h1 className="mb-3 text-xl font-semibold">{fmtExceptionType(exception.exception_type)}</h1>
            {exception.exception_type === 'gps_mismatch' && exception.source === 'system' && <p data-testid="gps-mismatch-trigger" className="mb-3 text-sm font-semibold">{GPS_MISMATCH_TRIGGER}</p>}
            <p className="text-sm leading-relaxed text-on-surf break-words">{exception.description}</p>
            {exception.exception_type === BREAKDOWN_TYPE && <div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="text-xs text-on-surf-v">Vehicle</span><span>{fmtBreakdownVehicle(exception)}</span></div>}
          </section>
            <section ref={assessmentPanel} className={`min-w-0 rounded-md xl:col-start-2 xl:row-start-1 xl:row-span-3 border border-outline-v/30 bg-surf-lowest p-4 sm:p-6 ${assessmentFits ? 'xl:sticky xl:top-4' : ''}`} aria-label="Assessment">
              <h2 ref={assessmentHeading} tabIndex={-1} className="mb-4 scroll-mt-4 text-lg font-semibold focus-visible:outline-sec">Assessment</h2>
              {lifecycleNotice && <p className="mb-4 text-xs leading-relaxed text-on-surf-v">{lifecycleNotice}</p>}
              {isReviewed ? <>
                <p className="mb-3 text-sm font-semibold text-ok">{exception.review_outcome && exception.review_outcome !== 'legacy_review' && exception.review_outcome !== 'dispatcher_authored' ? REVIEW_OUTCOME_LABELS[exception.review_outcome] : rState.kind === 'authored' ? 'Dispatcher note' : 'Reviewed'}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{exception.review_note ?? 'No note provided.'}</p>
                <div className="mt-4 flex flex-col gap-2 text-xs text-on-surf-v">
                  <span>{rState.label}{exception.reviewed_at ? ` · ${fmtExceptionRaised(exception.reviewed_at)}` : ''}</span>
                  {exception.contact_method && <span>{CONTACT_METHOD_LABELS[exception.contact_method]}</span>}
                  {showClaimerOnReviewed && claimedLine && <span>{claimedLine}</span>}
                </div>
              </> : <>
                {(rState.kind === 'unreviewed' || rState.kind === 'claimed_by_me' || claimedByOther) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-on-surf-v">
                  <span className="break-words">{claimedLine ?? 'Unclaimed'}</span>
                  {rState.kind === 'unreviewed' && <Button variant="secondary" onClick={handleClaim} disabled={claimBusy}>Claim</Button>}
                  {rState.kind === 'claimed_by_me' && <Button variant="secondary" onClick={handleRelease} disabled={claimBusy}>Release</Button>}
                  {claimedByOther && <Button variant="secondary" onClick={handleTakeOver} disabled={claimBusy}>{TAKE_OVER_LABEL}</Button>}
                </div>}
                {showForm ? <form onSubmit={handleReview} className="flex flex-col gap-4">
                  <ReviewFields idPrefix={`exception-${exceptionId}`} note={reviewNote} onNote={setReviewNote} outcome={reviewOutcome} onOutcome={setReviewOutcome} contact={contactMethod} onContact={setContactMethod} />
                  <p className="text-xs leading-relaxed text-on-surf-v">{COPY.confirm.reviewNotice}</p>
                  <p className="text-xs text-on-surf-v" role="status">{reviewing ? 'Submitting assessment…' : !reviewNote.trim() && !reviewOutcome ? 'Choose an outcome and enter a review note to submit.' : !reviewOutcome ? 'Choose an outcome to submit.' : !reviewNote.trim() ? 'Enter a review note to submit.' : 'Ready to submit.'}</p>
                  <Button type="submit" variant="primary" disabled={!reviewNote.trim() || reviewOutcome === NO_OUTCOME_CHOSEN || reviewing} loading={reviewing}>{submitLabel}</Button>
                </form> : <div className="flex flex-wrap items-center gap-3 text-sm text-on-surf-v"><span>Not yet reviewed</span><Button variant="secondary" onClick={() => setShowReviewForm(true)}>{COPY.actions.addReview}</Button></div>}
              </>}
            </section>
            <section className="xl:col-start-1 min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6 [&>section]:mt-0 [&>section]:border-0 [&>section]:pt-0" aria-label="Incident evidence">
              <ExceptionDetailEvidence exception={exception} />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
