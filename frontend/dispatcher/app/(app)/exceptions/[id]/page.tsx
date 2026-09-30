'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { BackButton } from '@/components/ui/BackButton'
import { SecHead }    from '@/components/ui/SecHead'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { Spinner }    from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  CONTACT_METHOD_LABELS, NO_CONTACT_CHOSEN, NO_OUTCOME_CHOSEN,
  REVIEW_OUTCOME_LABELS, ReviewFields,
} from '@/components/domain/ReviewFields'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { ExceptionEvidence } from '@/components/domain/ExceptionEvidence'
import { GPS_MISMATCH_TRIGGER } from '@/components/domain/PositionDisagreement'
import { ApiError, claimException, releaseException, reviewException } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { reviewState } from '@/lib/format/review-state'
import { useToast } from '@/lib/hooks/useToast'
import { useExceptionDetail } from '@/lib/hooks/useExceptionDetail'
import { fmtBreakdownVehicle } from '@/lib/format/exception'
import type {
  DispatcherReviewOutcome,
  ExceptionContactMethod,
  ExceptionReviewStatus,
  ExceptionType,
} from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META, TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ChipType } from '@shared/lib/constants/status-meta'
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

function fmtType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Builds "In Transit · Stop 2" from whichever of the two the row actually has, degrading
// to null (never the literal string "null" or a dangling "· ") when both are absent.
// Local rather than imported from the list page — this codebase already duplicates
// small per-page formatting helpers like this one (see fmtType/fmtTs above, and the
// list page's own copy of all three) rather than sharing them across pages.
function phaseStopLabel(phaseLabel: string | null, stopLabel: number | null): string | null {
  const parts: string[] = []
  if (phaseLabel) parts.push(phaseLabel)
  if (stopLabel !== null) parts.push(`Stop ${stopLabel}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// Local to this file, deliberately — same reasoning as the list page's own
// reviewStatusMeta: there is no shared meta for this 3-state badge because nothing
// outside these two exception screens needs it.
function reviewStatusMeta(status: ExceptionReviewStatus): { label: string; chipType: ChipType } {
  switch (status) {
    case 'reviewed':     return { label: 'Reviewed',     chipType: 'complete' }
    case 'needs_review': return { label: 'Needs Review', chipType: 'critical' }
    default:             return { label: 'Recorded',     chipType: 'pending' }
  }
}

// Explanatory, non-blocking copy for a trip whose lifecycle has already moved past
// "active" — reviewing is evidence handling, never trip lifecycle control (see
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

  // Only meaningful for a legacy 'recorded' row — the FP-280 backfill moved every such
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
  const backButton = <BackButton onClick={() => router.push(backTo)} />

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
  // useExceptionDetail fetches this one record directly by id — there is no client-side
  // list search left to distinguish "genuinely not found" from "some other fetch
  // failure", so `!exception` is the one honest condition covering both. A BACKGROUND
  // refresh failure (the hook refetches on exception_raised/exception_reviewed events
  // for this trip) must never reach this branch while a record is already on screen —
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
  const statusMeta = reviewStatusMeta(exception.review_status)
  const phaseStop  = phaseStopLabel(exception.phase_label, exception.stop_label)
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
    // Both gates, not just the disabled attribute — a form can still be submitted by
    // keyboard, and neither field may reach the API unset. Contact method is exempt: it
    // is optional by design, so it never belongs in this gate.
    if (!trimmedNote || reviewOutcome === NO_OUTCOME_CHOSEN) return
    setReviewing(true)
    try {
      await reviewException(exceptionId, {
        review_note: trimmedNote,
        review_outcome: reviewOutcome,
        // Explicit null, not an omitted key — the backend requires the key present so
        // it can tell "no contact happened" apart from a client that forgot the field.
        contact_method: contactMethod || null,
        // Omitted (not false) unless taking over, so an ordinary review body is unchanged.
        ...(claimedByOther ? { take_over: true } : {}),
      })
      notify({ kind: 'success', title: COPY.toast.exceptionReviewed })
      // No refetch before navigating: this hook instance dies with the page, and
      // useAsyncData's mountedRef discards a result that lands after unmount. Whichever
      // screen receives us mounts its own hook and fetches on mount — the trip detail
      // page may paint a cached copy first, but it always revalidates, so a review made
      // here cannot leave a stale review status on screen.
      router.push(backTo)
    } catch (err) {
      // Surfaced, never swallowed — the old resolve flow's bug was a fake unconditional
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
      <TopBar
        title={fmtType(exception.exception_type)}
        sub={`${sevMeta.label} · ${statusMeta.label}`}
        left={backButton}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-4">

          {/* A background refresh failed while a loaded record stayed on screen — never
              a full-page error (see the !exception branch's own comment above). */}
          {error && (
            <div className="flex items-center justify-between gap-4 rounded-lg bg-warn-c px-5 py-3">
              <div className="flex items-center gap-[9px]">
                <Ic n="warn" s={14} className="text-warn-onc shrink-0" />
                <span className="text-[12px] font-[600] text-warn-onc">
                  This record may be out of date — the last refresh failed.
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={refetch}>Retry</Button>
            </div>
          )}

          {/* Related trip banner. Reference and status both ride on the exception
              itself (denormalised off the org-scoping join), so this costs no second
              request. */}
          <div className="bg-surf-low rounded-lg px-5 py-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-1">
                Related Trip
              </div>
              <div className="flex items-center gap-2">
                <TripIdStamp tripReference={exception.trip_reference} />
                <Chip type={tripMeta.chipType} label={tripMeta.label} />
              </div>
            </div>
            <button
              onClick={() => router.push(ROUTES.tripDetail(exception.trip_id))}
              className="flex items-center gap-1 text-[13px] font-[600] text-sec hover:opacity-75 transition-opacity"
            >
              View trip <Ic n="chev" s={14} className="text-sec" />
            </button>
          </div>

          {/* Trip lifecycle notice — explanatory only. Never disables or hides the
              review section below: the backend enforces no trip-status gate on the
              review endpoint at all (see review_exception's own docstring), so neither
              does this page. */}
          {lifecycleNotice && (
            <div className="bg-surf-low rounded-lg px-5 py-3 text-[12px] text-on-surf-v">
              {lifecycleNotice}
            </div>
          )}

          {/* Exception detail card */}
          <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
            <SecHead title="Exception Details" />
            <div className="p-6">

              {/* Chips + source row */}
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <Chip type={sevMeta.chipType} label={sevMeta.label} />
                <Chip type={statusMeta.chipType} label={statusMeta.label} />
                <span className="ml-auto text-[11px] text-on-surf-v font-[500]">
                  {srcMeta.label} · {fmtTs(exception.created_at)}
                </span>
              </div>

              {/* The stored trigger, stated explicitly: a gps_mismatch is raised ONLY
                  when the vehicle tracker's own fix fell outside the stop's geofence,
                  never from a phone-vs-tracker disagreement. Imported from
                  PositionDisagreement so the timeline and this page can never drift into
                  paraphrasing the fact differently. Gated on source === 'system' too: a
                  driver can also raise a gps_mismatch (DriverExceptionCreateBody accepts
                  it), and that row carries no tracker verdict for this sentence to state. */}
              {exception.exception_type === 'gps_mismatch' && exception.source === 'system' && (
                <p data-testid="gps-mismatch-trigger" className="text-[13px] font-[700] text-on-surf mb-3">
                  {GPS_MISMATCH_TRIGGER}
                </p>
              )}

              {/* Description */}
              <div className="bg-surf-low rounded-lg p-4 mb-5">
                <p className="text-[14px] text-on-surf leading-relaxed">{exception.description}</p>
              </div>

              {/* Meta rows */}
              <div className="flex flex-col">
                {([
                  ['Source', srcMeta.label],
                  ['Raised', fmtTs(exception.created_at)],
                  ...(phaseStop ? [['Phase / Stop', phaseStop]] as [string, string][] : []),
                  ...(exception.exception_type === BREAKDOWN_TYPE
                    ? [['Vehicle', fmtBreakdownVehicle(exception)]] as [string, string][]
                    : []),
                ] as [string, string][]).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start gap-3 py-2 border-b border-outline-v/10 last:border-0"
                  >
                    <span className="text-[11px] text-on-surf-v w-24 shrink-0 pt-px">{label}</span>
                    <span className="text-[13px] font-[500] text-on-surf">{value}</span>
                  </div>
                ))}
              </div>

              {/* What the driver/system actually captured — GPS fix and/or photo. */}
              <ExceptionEvidence exception={exception} artifact={exception.supporting_artifact ?? undefined} />
            </div>
          </div>

          {/* Review card */}
          {isReviewed ? (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
              <SecHead title="Review" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Ic n="check" s={16} className="text-ok shrink-0" />
                  <span className="text-[14px] font-[700] text-ok">
                    {exception.review_outcome && exception.review_outcome !== 'legacy_review'
                      && exception.review_outcome !== 'dispatcher_authored'
                      ? REVIEW_OUTCOME_LABELS[exception.review_outcome]
                      : 'Reviewed'}
                  </span>
                </div>
                <div className="bg-surf-low rounded-lg p-4 mb-4">
                  <p className="text-[14px] text-on-surf leading-relaxed">
                    {exception.review_note ?? 'No note provided.'}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {exception.reviewed_at && (
                    <div className="flex items-center gap-1.5 text-[11px] font-[500] text-sec tabular-nums">
                      <Ic n="clock" s={10} className="text-sec shrink-0" />
                      {fmtDateTime(exception.reviewed_at)}
                    </div>
                  )}
                  {/* Null for anything reviewed without any contact having happened —
                      evidence alone settled it. Shown as absent rather than guessed;
                      inventing contact history on an evidence record is worse than
                      admitting the gap. */}
                  {exception.contact_method && (
                    <div className="text-[11px] font-[500] text-sec">
                      {CONTACT_METHOD_LABELS[exception.contact_method]}
                    </div>
                  )}
                </div>
                {/* Names come from the server (users.full_name, org-scoped) — FP-280. */}
                <div className="flex flex-col gap-1 mt-3 text-[11px] font-[500] text-sec">
                  <span>
                    {rState.label}{exception.reviewed_at ? ` · ${fmtDateTime(exception.reviewed_at)}` : ''}
                  </span>
                  {showClaimerOnReviewed && claimedLine && <span>{claimedLine}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
              <SecHead title={needsReview ? 'Review Required' : 'Review Exception'} />
              {(rState.kind === 'unreviewed' || rState.kind === 'claimed_by_me' || claimedByOther) && (
                <div className="px-6 pt-4 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-on-surf-v">
                    {claimedLine ?? 'Not claimed'}
                  </span>
                  {rState.kind === 'unreviewed' && (
                    <Button variant="secondary" size="sm" onClick={handleClaim} disabled={claimBusy}>Claim</Button>
                  )}
                  {rState.kind === 'claimed_by_me' && (
                    <Button variant="secondary" size="sm" onClick={handleRelease} disabled={claimBusy}>Release</Button>
                  )}
                  {claimedByOther && (
                    <Button variant="secondary" size="sm" onClick={handleTakeOver} disabled={claimBusy}>
                      {TAKE_OVER_LABEL}
                    </Button>
                  )}
                </div>
              )}
              {showForm ? (
                <form onSubmit={handleReview} className="p-6 flex flex-col gap-4">
                  <ReviewFields
                    note={reviewNote}       onNote={setReviewNote}
                    outcome={reviewOutcome} onOutcome={setReviewOutcome}
                    contact={contactMethod} onContact={setContactMethod}
                  />
                  <p className="text-[12px] text-on-surf-v">{COPY.confirm.reviewNotice}</p>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="success"
                      disabled={!reviewNote.trim() || reviewOutcome === NO_OUTCOME_CHOSEN || reviewing}
                      loading={reviewing}
                      iconLeft={<Ic n="check" s={14} c="white" />}
                    >
                      {submitLabel}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="p-6 flex items-center justify-between">
                  <span className="text-[13px] text-on-surf-v">Not yet reviewed</span>
                  <Button variant="secondary" size="sm" onClick={() => setShowReviewForm(true)}>
                    {COPY.actions.addReview}
                  </Button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
