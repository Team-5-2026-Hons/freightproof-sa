'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

interface LocationCheckNoticeProps {
  assessment: ActionLocationAssessment | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onContinue: (reason: string | null) => void
}

function measuredMismatchCopy(assessment: ActionLocationAssessment): string {
  const separation = Math.round(assessment.separation_metres ?? 0)
  const limit = Math.round(assessment.max_separation_metres)
  return `Driver and truck were recorded ${separation} m apart. Limit: ${limit} m.`
}

/**
 * Presents a server assessment without turning a location warning into a client-side
 * verdict. A driver's acknowledgement records what they saw; final evidence remains
 * the assessment assembled by the backend when the phase is actually submitted.
 */
export function LocationCheckNotice({
  assessment, loading, error, onRetry, onContinue,
}: LocationCheckNoticeProps) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const measuredMismatch = assessment?.proximity === 'separated' && assessment.separation_metres !== null
  const wrongPrecinct = assessment?.truck_in_precinct === false
  const requiresReason = measuredMismatch || wrongPrecinct

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
    return <p role="status" aria-live="polite" className="text-sm text-surface-on-variant">Checking location…</p>
  }

  if (error !== null) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-container/30 p-4" aria-label="Location check">
        <p role="alert" className="text-sm text-warning-on-container">
          Location check could not be completed. Your action can still be recorded.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
          <Button size="sm" onClick={continueAction}>Continue</Button>
        </div>
      </section>
    )
  }

  if (assessment === null || assessment.proximity === 'unverified') {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-4" aria-label="Location check">
        <p className="text-sm text-surface-on-variant">
          We could not compare your location with the truck. Your action can still be recorded.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
          <Button size="sm" onClick={continueAction}>Continue</Button>
        </div>
      </section>
    )
  }

  if (!requiresReason) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-success/40 bg-success-container/30 p-4" aria-label="Location check">
        <p className="text-sm text-success-on-container">Location check passed.</p>
        <Button size="sm" className="self-start" onClick={continueAction}>Continue</Button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-container/30 p-4" aria-label="Location warning">
      <p className="text-sm font-medium text-warning-on-container">
        {measuredMismatch ? measuredMismatchCopy(assessment) : 'Truck was recorded outside the expected loading precinct.'}
      </p>
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
      {reasonError !== null && <p id="location-warning-reason-error" role="alert" className="text-sm text-error">{reasonError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onRetry}>Retry location</Button>
        <Button size="sm" onClick={continueAction}>Continue with exception</Button>
      </div>
    </section>
  )
}
