'use client'

import { useEffect, useState } from 'react'
import { MapPin, MapPinCheck, MapPinOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

interface LocationCheckModalProps {
  open: boolean
  assessment: ActionLocationAssessment | null
  loading: boolean
  error: string | null
  offline: boolean
  onRetry: () => void
  onContinue: (reason: string | null) => void
}

const METRES = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

function noOpClose(): void {}

const DISC = 'flex size-12 items-center justify-center rounded-full'

function FactRow({ label, value, tone }: { label: string; value: string; tone?: 'attention' }) {
  return (
    <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-x-3 py-2">
      <span className="text-subhead text-surface-on-variant">{label}</span>
      <span className={cn('text-body font-semibold tabular-nums', tone === 'attention' ? 'text-attention-ink' : 'text-surface-on')}>{value}</span>
    </div>
  )
}

/**
 * Blocking popup for the per-phase driver-vs-truck location check, so a driver cannot
 * miss it below the fold. It never computes a verdict client-side, only records what the SERVER's assessment said and
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

  const retry = <Button variant="fill" size="pill" onClick={onRetry}>Retry Location</Button>

  if (loading) {
    return (
      <Modal
        open={open}
        onClose={noOpClose}
        dismissible={false}
        title="Checking location"
        icon={<span aria-hidden className={cn(DISC, 'bg-fill')}><Spinner size="sm" /></span>}
      >
        <p role="status" aria-live="polite" className="text-subhead text-surface-on-variant">Checking location…</p>
      </Modal>
    )
  }

  if (error !== null) {
    return (
      <Modal
        open={open}
        onClose={noOpClose}
        dismissible={false}
        title="Location check"
        icon={<span className={cn(DISC, 'bg-attention-tint text-attention-ink')}><MapPinOff className="size-6" strokeWidth={2} aria-hidden /></span>}
        footer={<><Button size="pill" onClick={continueAction}>Continue</Button>{retry}</>}
      >
        <p role="alert" className="text-subhead text-surface-on-variant">
          Location check could not be completed. Your action can still be recorded.
        </p>
      </Modal>
    )
  }

  if (assessment === null || assessment.proximity === 'unverified') {
    return (
      <Modal
        open={open}
        onClose={noOpClose}
        dismissible={false}
        title="Location not compared"
        icon={<span className={cn(DISC, 'bg-fill text-surface-on')}><MapPinOff className="size-6" strokeWidth={2} aria-hidden /></span>}
        footer={<><Button size="pill" onClick={continueAction}>Continue</Button>{retry}</>}
      >
        <div className="flex flex-col gap-2 text-subhead text-surface-on-variant">
          {offline && <p>Location not verified while offline.</p>}
          <p>We could not compare your location with the truck. Your action can still be recorded.</p>
        </div>
      </Modal>
    )
  }

  if (!requiresReason) {
    return (
      <Modal
        open={open}
        onClose={noOpClose}
        dismissible={false}
        title="Location matches"
        icon={<span className={cn(DISC, 'bg-success-tint text-success-ink')}><MapPinCheck className="size-6" strokeWidth={2} aria-hidden /></span>}
        footer={<Button size="pill" onClick={continueAction}>Continue</Button>}
      >
        <p className="text-subhead text-surface-on-variant">Location check passed.</p>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={noOpClose}
      dismissible={false}
      title="Location doesn’t match"
      description="You can still continue. It’s recorded as an exception with your reason."
      icon={<span className={cn(DISC, 'bg-attention-tint text-attention-ink')}><MapPin className="size-6" strokeWidth={2} aria-hidden /></span>}
      footer={<><Button size="pill" onClick={continueAction}>Continue with Exception</Button>{retry}</>}
    >
      <div className="divide-y divide-hairline rounded-2xl bg-fill px-4">
        {measuredMismatch && (
          <>
            <FactRow label="Phone to truck" value={`${METRES.format(assessment.separation_metres ?? 0)} m apart`} tone="attention" />
            <FactRow label="Allowed" value={`${METRES.format(assessment.max_separation_metres)} m`} />
          </>
        )}
        {truckOutside && (
          <p className="py-3 text-subhead font-semibold text-attention-ink">Truck was recorded outside the expected precinct.</p>
        )}
        {driverOutside && (
          <p className="py-3 text-subhead font-semibold text-attention-ink">Your phone was recorded outside the expected precinct.</p>
        )}
      </div>
      <label className="mt-[18px] block text-subhead text-surface-on-variant" htmlFor="location-warning-reason">
        Reason for continuing
      </label>
      <textarea
        id="location-warning-reason"
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-describedby={reasonError === null ? undefined : 'location-warning-reason-error'}
        aria-invalid={reasonError !== null || undefined}
        className="mt-2 w-full resize-none rounded-[14px] bg-fill px-4 py-3.5 text-body text-surface-on outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {reasonError !== null && (
        <p id="location-warning-reason-error" role="alert" className="mt-1.5 text-subhead text-error">{reasonError}</p>
      )}
    </Modal>
  )
}
