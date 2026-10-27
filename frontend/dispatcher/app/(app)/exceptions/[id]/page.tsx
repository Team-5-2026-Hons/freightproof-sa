'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { BackButton } from '@/components/ui/BackButton'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  CONTACT_METHOD_LABELS, NO_CONTACT_CHOSEN, NO_OUTCOME_CHOSEN,
  REVIEW_OUTCOME_LABELS, ReviewFields,
} from '@/components/domain/ReviewFields'
import { ExceptionDetailEvidence } from '@/components/exceptions/ExceptionDetailEvidence'
import { ExceptionHederaLinks } from '@/components/exceptions/ExceptionHederaLinks'
import { ExceptionRef } from '@/components/domain/ExceptionRef'
import { ExceptionDetailSkeleton } from '@/components/exceptions/ExceptionDetailSkeleton'
import { ExceptionIncidentPanel } from '@/components/incidents/ExceptionIncidentPanel'
import { GPS_MISMATCH_TRIGGER } from '@/components/domain/PositionDisagreement'
import { ApiError, claimException, releaseException, reviewException } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { reviewState, type ReviewState } from '@/lib/format/review-state'
import { useToast } from '@/lib/hooks/useToast'
import { useExceptionDetail } from '@/lib/hooks/useExceptionDetail'
import { exceptionDescriptionText, fmtBreakdownVehicle, fmtExceptionType, fmtExceptionRaised, fmtExceptionPhaseStop, fmtExceptionRoute } from '@/lib/format/exception'
import type {
  DispatcherReviewOutcome,
  ExceptionContactMethod,
  ExceptionReviewStatus,
  ExceptionType,
} from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META, TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_LEVEL_SCOPE } from '@/lib/phase/exception-rows'
import { buildTripPanelQuery } from '@/lib/trips/panel-query'
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/navigation/returnTo'

const BREAKDOWN_TYPE: ExceptionType = 'mechanical'

const CONFLICT_TOAST_TITLE = 'A colleague got there first'
const TAKE_OVER_LABEL = 'Take over'
const TAKE_OVER_AND_REVIEW_LABEL = 'Take over and review'
const ASSESSMENT_SCROLL_GUTTER_PX = 32

function tripLifecycleNotice(status: TripStatus): string | null {
  switch (status) {
    case 'closed':         return 'Trip closed. Reviewing this exception does not reopen the trip.'
    case 'cancelled':       return 'Trip cancelled. Reviewing this exception does not change the trip.'
    case 'exception_hold':  return 'Trip on exception hold. Reviewing this exception does not clear the hold.'
    default:                 return null
  }
}

const NO_PHASE_LABEL = 'Trip-level record, no phase'

function ContextItem({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return <div className={`min-w-0 border-l-2 border-outline-v/40 pl-3 ${className}`}>
    <dt className="text-[10px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-on-surf">{value}</dd>
  </div>
}

function reviewChipLabel(reviewStatus: ExceptionReviewStatus, ownership: ReviewState): string {
  if (reviewStatus === 'reviewed') return 'Reviewed'
  if (reviewStatus === 'recorded') return 'Recorded'
  const claimed = ownership.kind === 'claimed_by_me' || ownership.kind === 'claimed_by_other'
  return claimed ? `Needs review · ${ownership.label}` : 'Needs review'
}

export default function ExceptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const search = useSearchParams()
  const backTo = safeReturnTo(search.get(RETURN_TO_PARAM), ROUTES.exceptions)
  const { notify } = useToast()

  const { user } = useAuth()
  const meId = user?.id ?? null

  const exceptionId = params.id as string
  const { exception, isLoading, error, refetch, refetchSilent } = useExceptionDetail(exceptionId)

  const [showReviewForm, setShowReviewForm] = useState(false)

  const [reviewNote, setReviewNote]         = useState('')
  const [reviewOutcome, setReviewOutcome]   =
    useState<DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN>(NO_OUTCOME_CHOSEN)
  const [contactMethod, setContactMethod]   =
    useState<ExceptionContactMethod | typeof NO_CONTACT_CHOSEN>(NO_CONTACT_CHOSEN)
  const [reviewing, setReviewing]           = useState(false)
  const [claimBusy, setClaimBusy]            = useState(false)

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

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TopBar title="Exception Detail" left={backButton} />
        <ExceptionDetailSkeleton />
      </div>
    )
  }

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

  const exceptionTitle = fmtExceptionType(exception.exception_type)
  const sevMeta    = EXCEPTION_SEVERITY_META[exception.severity]
  const srcMeta    = EXCEPTION_SOURCE_META[exception.source]
  const tripMeta   = TRIP_STATUS_META[exception.trip_status]
  const phaseStop  = fmtExceptionPhaseStop(exception.phase_label, exception.stop_label)
  const phaseScope = exception.phase_event_id === undefined ? undefined : exception.phase_event_id ?? TRIP_LEVEL_SCOPE
  const tripQuery  = buildTripPanelQuery('', { panel: 'exceptions', filter: 'all', phaseId: phaseScope, exceptionId: exception.id })
  const phaseValue = exception.phase_label ? phaseStop ?? NO_PHASE_LABEL : [NO_PHASE_LABEL, phaseStop].filter(Boolean).join(' · ')
  const lifecycleNotice = tripLifecycleNotice(exception.trip_status)

  const isReviewed   = exception.review_status === 'reviewed'
  const needsReview  = exception.review_status === 'needs_review'
  const showForm     = needsReview || showReviewForm
  const rState       = reviewState(exception, meId)
  const claimedByOther = rState.kind === 'claimed_by_other'
  const submitLabel  = claimedByOther ? TAKE_OVER_AND_REVIEW_LABEL : COPY.actions.submitReview
  const claimedLine  = exception.claimed_by_user_id !== null
    ? `${rState.kind === 'claimed_by_me' ? 'Claimed by you' : `Claimed by ${exception.claimed_by_name ?? 'a colleague'}`}${
        exception.claimed_at ? ` · ${fmtExceptionRaised(exception.claimed_at)}` : ''}`
    : null
  const reviewNotice = lifecycleNotice ?? (showForm ? COPY.confirm.reviewNotice : null)
  const showClaimerOnReviewed =
    exception.claimed_by_user_id !== null
    && exception.claimed_by_user_id !== exception.reviewed_by_user_id

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
    if (!trimmedNote || reviewOutcome === NO_OUTCOME_CHOSEN || reviewing) return
    setReviewing(true)
    try {
      await reviewException(exceptionId, {
        review_note: trimmedNote,
        review_outcome: reviewOutcome,
        contact_method: contactMethod || null,
        ...(claimedByOther ? { take_over: true } : {}),
      })
      notify({ kind: 'success', title: COPY.toast.exceptionReviewed })
      router.push(backTo)
    } catch (err) {
      const lostTheRace = err instanceof ApiError && err.status === 409
      notify({
        kind: 'error',
        title: lostTheRace ? CONFLICT_TOAST_TITLE : 'Could not review this exception',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
      if (lostTheRace) refetchSilent()
      setReviewing(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={exceptionTitle} left={backButton} identity={
        <div className="min-w-0">
          <h1 className="text-[18px] font-[800] leading-tight tracking-[-0.02em] text-on-surf">{exceptionTitle}</h1>
          <p className="mt-[2px] break-words text-xs font-medium tracking-[0.03em] text-sec tabular-nums">
            <ExceptionRef id={exception.id} />
          </p>
        </div>
      } />
      <div ref={detailScroller} className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 py-6">
          {error && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-c px-4 py-3 text-sm text-warn-onc">
            This record may be out of date, the last refresh failed.<Button variant="ghost" onClick={refetchSilent}>Retry</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <Chip type={sevMeta.chipType} label={sevMeta.label} />
            <span data-testid="review-state-chip"><Chip type="pending" label={reviewChipLabel(exception.review_status, rState)} /></span>
            <Button variant="ghost" size="sm" className="ml-auto xl:hidden" onClick={() => assessmentHeading.current?.focus()}>Jump to assessment</Button>
          </div>
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_auto_auto_1fr] xl:gap-x-6">
          <section aria-label="Trip context" className="xl:col-start-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-sm font-medium text-on-surf-v">{tripMeta.label}</p>
              <Button variant="secondary" size="sm" onClick={() => navigate(`${ROUTES.tripDetail(exception.trip_id)}?${tripQuery}`)}>View trip <Ic n="chev" s={14} /></Button>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
              <ContextItem label="Trip" value={exception.trip_reference} />
              <ContextItem label="Raised" value={fmtExceptionRaised(exception.created_at)} />
              <ContextItem label="Source" value={srcMeta.label} />
              <ContextItem label="Phase" className="sm:col-span-3" value={phaseValue} />
              <ContextItem label="Route" className="sm:col-span-3" value={fmtExceptionRoute(exception.origin_name, exception.destination_name)} />
              <ContextItem label="Driver" value={exception.driver_name ?? 'Not recorded'} />
              <ContextItem label="Truck" value={exception.horse_registration ?? 'Not recorded'} />
              <ContextItem label="Trailers" value={exception.trailer_registrations.length ? exception.trailer_registrations.join(', ') : 'None attached'} />
            </dl>
          </section>
          <section className="xl:col-start-1 min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6" aria-label="Incident">
            {exception.exception_type === 'gps_mismatch' && exception.source === 'system' && <p data-testid="gps-mismatch-trigger" className="mb-3 text-sm font-semibold">{GPS_MISMATCH_TRIGGER}</p>}
            <p className="text-sm leading-relaxed text-on-surf break-words">{exceptionDescriptionText(exception)}</p>
            {exception.exception_type === BREAKDOWN_TYPE && <div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="text-xs text-on-surf-v">Vehicle</span><span>{fmtBreakdownVehicle(exception)}</span></div>}
          </section>
          <div className="xl:col-start-1 min-w-0">
            <ExceptionIncidentPanel exceptionId={exception.id} tripId={exception.trip_id} exceptionType={exception.exception_type}
              description={exception.description} onNavigate={navigate} />
          </div>
            <section ref={assessmentPanel} className={`min-w-0 overflow-hidden rounded-md xl:col-start-2 xl:row-start-1 xl:row-span-4 border border-outline-v/60 bg-surf-lowest shadow-level-1 ${assessmentFits ? 'xl:sticky xl:top-4' : ''}`} aria-label="Assessment">
              <div className="border-b border-outline-v/30 bg-surf-low px-4 py-[10px] sm:px-6">
                <h2 ref={assessmentHeading} tabIndex={-1} className="scroll-mt-4 text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v focus-visible:outline-sec">Assessment</h2>
              </div>
              <div className="p-4 sm:p-6">
              {isReviewed ? <>
                <p className="mb-3 text-sm font-semibold text-ok">{exception.review_outcome && exception.review_outcome !== 'legacy_review' && exception.review_outcome !== 'dispatcher_authored' ? REVIEW_OUTCOME_LABELS[exception.review_outcome] : rState.kind === 'authored' ? 'Dispatcher note' : 'Reviewed'}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{exception.review_note ?? 'No note provided.'}</p>
                <div className="mt-4 flex flex-col gap-2 text-xs text-on-surf-v">
                  <span>{rState.label}{exception.reviewed_at ? ` · ${fmtExceptionRaised(exception.reviewed_at)}` : ''}</span>
                  {exception.contact_method && <span>{CONTACT_METHOD_LABELS[exception.contact_method]}</span>}
                  {showClaimerOnReviewed && claimedLine && <span>{claimedLine}</span>}
                </div>
                {reviewNotice && <p className="mt-4 text-xs leading-relaxed text-on-surf-v">{reviewNotice}</p>}
              </> : <>
                {(rState.kind === 'unreviewed' || rState.kind === 'claimed_by_me' || claimedByOther) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-on-surf-v">
                  <span className="break-words">{claimedLine ?? 'Unclaimed'}</span>
                  {rState.kind === 'unreviewed' && <Button variant="secondary" onClick={handleClaim} disabled={claimBusy}>Claim</Button>}
                  {rState.kind === 'claimed_by_me' && <Button variant="secondary" onClick={handleRelease} disabled={claimBusy}>Release</Button>}
                  {claimedByOther && <Button variant="secondary" onClick={handleTakeOver} disabled={claimBusy}>{TAKE_OVER_LABEL}</Button>}
                </div>}
                {showForm ? <form onSubmit={handleReview} className="flex flex-col gap-4">
                  <ReviewFields idPrefix={`exception-${exceptionId}`} note={reviewNote} onNote={setReviewNote} outcome={reviewOutcome} onOutcome={setReviewOutcome} contact={contactMethod} onContact={setContactMethod} />
                  <div className="flex flex-col gap-2 border-t border-outline-v/30 pt-4">
                  {reviewNotice && <p className="text-xs leading-relaxed text-on-surf-v">{reviewNotice}</p>}
                  <p className="text-xs text-on-surf-v" role="status">{reviewing ? 'Submitting assessment…' : !reviewNote.trim() && !reviewOutcome ? 'Choose an outcome and enter a review note to submit.' : !reviewOutcome ? 'Choose an outcome to submit.' : !reviewNote.trim() ? 'Enter a review note to submit.' : 'Ready to submit.'}</p>
                  <Button type="submit" variant="primary" disabled={!reviewNote.trim() || reviewOutcome === NO_OUTCOME_CHOSEN || reviewing} loading={reviewing}>{submitLabel}</Button>
                  </div>
                </form> : <>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-on-surf-v"><span>Not yet reviewed</span><Button variant="secondary" onClick={() => setShowReviewForm(true)}>{COPY.actions.addReview}</Button></div>
                  {reviewNotice && <p className="mt-4 text-xs leading-relaxed text-on-surf-v">{reviewNotice}</p>}
                </>}
              </>}
              </div>
            </section>
            <section className="xl:col-start-1 min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6 [&>section]:mt-0 [&>section]:border-0 [&>section]:pt-0" aria-label="Incident evidence">
              <ExceptionDetailEvidence exception={exception} />
              <ExceptionHederaLinks events={exception.anchor_events ?? []} />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
