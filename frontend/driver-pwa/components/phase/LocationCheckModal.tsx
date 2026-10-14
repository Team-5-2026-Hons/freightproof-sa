'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

interface LocationCheckModalProps {
  /** Controls the popup's visibility — the caller decides when a check is in flight
   *  or has landed on an outcome that needs a driver decision. A clean pass never
   *  sets this true for long enough to require a tap (see the call sites). */
  open: boolean
  assessment: ActionLocationAssessment | null
  loading: boolean
  error: string | null
  /** True while the check ran without a network connection — surfaced inline rather
   *  than left orphaned on the page behind it. */
  offline: boolean
  onRetry: () => void
  onContinue: (reason: string | null) => void
}

function measuredMismatchCopy(assessment: ActionLocationAssessment): string {
  const separation = Math.round(assessment.separation_metres ?? 0)
  const limit = Math.round(assessment.max_separation_metres)
  return `Driver and truck were recorded ${separation} m apart. Limit: ${limit} m.`
}

// Modal requires an onClose even when dismissible=false (never invoked in that
// mode — see Modal.tsx), so every branch below shares one no-op rather than each
// allocating its own.
function noOpClose(): void {}

/**
 * Blocking popup for the per-phase driver-vs-truck location check — replaces the old
 * bottom-of-page LocationCheckNotice, which rendered below the fold where a driver
 * could miss it entirely. Presents the SAME state machine as a modal: it never
 * computes a verdict client-side, only records what the SERVER's assessment said and
 * what the driver chose to do about it (final evidence is assembled by the backend at
 * submit time regardless of what this component shows).
 *
 * Non-dismissible by design (Modal's dismissible=false): Retry and Continue are both
 * recorded outcomes, and a stray Escape/overlay tap must not silently drop the driver
 * back onto a step whose evidence capture already happened.
 */
export function LocationCheckModal({
  open, assessment, loading, error, offline, onRetry, onContinue,
}: LocationCheckModalProps) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  // A reason typed against one assessment must never silently ride along with the
  // next one — reset whenever the popup closes (a fresh check, a retry that has not
  // yet resolved, or a hand-off away from this screen).
  useEffect(() => {
    if (!open) {
      setReason('')
      setReasonError(null)
    }
  }, [open])

  const measuredMismatch = assessment?.proximity === 'separated' && assessment.separation_metres !== null
  const truckOutside = assessment?.truck_in_precinct === false
  const driverOutside = assessment?.driver_in_precinct === false
  const requiresReason = measuredMismatch || truckOutside || driverOutside

  function continueAction(): void {
    const trimmedReason = reason.trim()
    if (requiresReason && !trimmedReason) {
      setReasonError('Please provide a reason before continuing.')
      return
    }
    setReasonError(null)
    onContinue(requiresReason ? trimmedReason : null)
  }

  if (loading) {
    return (
      <Modal open={open} onClose={noOpClose} dismissible={false} title="Checking location" size="sm">
        <p role="status" aria-live="polite" className="text-sm text-surface-on-variant">Checking location…</p>
      </Modal>
    )
  }

  if (error !== null) {
    return (
      <Modal open={open} onClose={noOpClose} dismissible={false} title="Location check" size="sm">
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-warning-on-container">
            Location check could not be completed. Your action can still be recorded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
            <Button size="sm" onClick={continueAction}>Continue</Button>
          </div>
        </div>
      </Modal>
    )
  }

  if (assessment === null || assessment.proximity === 'unverified') {
    return (
      <Modal open={open} onClose={noOpClose} dismissible={false} title="Location check" size="sm">
        <div className="flex flex-col gap-3">
          {offline && (
            <p className="text-sm text-surface-on-variant">Location not verified while offline.</p>
          )}
          <p className="text-sm text-surface-on-variant">
            We could not compare your location with the truck. Your action can still be recorded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
            <Button size="sm" onClick={continueAction}>Continue</Button>
          </div>
        </div>
      </Modal>
    )
  }

  if (!requiresReason) {
    return (
      <Modal open={open} onClose={noOpClose} dismissible={false} title="Location check" size="sm">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-success-on-container">Location check passed.</p>
          <Button size="sm" className="self-start" onClick={continueAction}>Continue</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={noOpClose} dismissible={false} title="Location warning" size="sm">
      <div className="flex flex-col gap-3">
        {/* Each active fact gets its own sentence, stated independently — a driver
            outside the precinct and a truck outside the precinct are two different
            claims, and when both are true the driver needs to see both, not whichever
            one a priority order happened to pick. */}
        {measuredMismatch && (
          <p className="text-sm font-medium text-warning-on-container">{measuredMismatchCopy(assessment)}</p>
        )}
        {truckOutside && (
          <p className="text-sm font-medium text-warning-on-container">
            Truck was recorded outside the expected precinct.
          </p>
        )}
        {driverOutside && (
          <p className="text-sm font-medium text-warning-on-container">
            Your phone was recorded outside the expected precinct.
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-sm text-surface-on" htmlFor="location-warning-reason">
          Reason for continuing
          <textarea
            id="location-warning-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={reasonError === null ? undefined : 'location-warning-reason-error'}
            className="min-h-20 rounded-lg border border-outline-variant bg-surface-container-lowest p-3"
          />
        </label>
        {reasonError !== null && (
          <p id="location-warning-reason-error" role="alert" className="text-sm text-error">{reasonError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
          <Button size="sm" onClick={continueAction}>Continue with exception</Button>
        </div>
      </div>
    </Modal>
  )
}
