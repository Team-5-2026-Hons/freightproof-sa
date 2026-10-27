'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { TextArea } from '@/components/ui/TextArea'
import { useToast } from '@/lib/hooks/useToast'
import { cancelTrip, ApiError } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'

const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

export function isTripTerminal(status: Trip['status']): boolean {
  return TERMINAL_STATUSES.includes(status)
}

interface Props {
  tripId: string
  status: Trip['status']
  open: boolean
  onClose: () => void
  onCancelled: () => void
}

/**
 * The dispatcher's only way to end a trip abandoned mid-plan (cargo pulled, vehicle
 * broken down). This makes good on the promise the trip-creation wizard already states
 * up front: a trip can never be deleted, only cancelled — its phase rows and any
 * evidence already captured stay on the record exactly as they are.
 *
 * Controlled by the caller (TripDetailPanel) rather than owning its own trigger: below
 * the dock width the trip information panel renders inside DetailPanel's own overlay
 * <dialog>, and a modal nested inside another open modal centres on the ancestor's box
 * instead of the viewport. Rendering this as a sibling of that overlay avoids the bug.
 */
export function CancelTripDialog({ tripId, status, open, onClose, onCancelled }: Props) {
  const { notify } = useToast()
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  const terminal = isTripTerminal(status)

  useEffect(() => {
    if (open && terminal) onClose()
  }, [open, terminal, onClose])

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setNote('')
  }

  if (!open || terminal) return null

  function close() {
    if (submitting) return
    setNote('')
    onClose()
  }

  async function submit() {
    if (submitting || !note.trim()) return
    setSubmitting(true)
    try {
      await cancelTrip(tripId, note.trim())
      notify({ kind: 'success', title: 'Trip cancelled' })
      setNote('')
      onCancelled()
      onClose()
    } catch (err) {
      const title =
        err instanceof ApiError && (err.status === 404 || err.status === 409) ? err.message
        : err instanceof ApiError && err.status === 422 ? 'A cancellation note is required.'
        : 'Failed to cancel trip. Please try again.'
      notify({ kind: 'error', title })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={close} closeDisabled={submitting} title={'Cancel this trip?'}>
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-[2px] shrink-0 rounded-full bg-err-c p-[6px]">
          <Ic n="warn" s={16} className="text-err" />
        </div>
        <div>
          <div className="text-[13px] text-on-surf-v mt-[4px] leading-relaxed">
            This trip will be cancelled, never deleted. Every phase and every piece
            of evidence already recorded stays exactly as it is on the trip&apos;s
            record. This action cannot be undone.
          </div>
        </div>
      </div>

      <TextArea
        label="Reason for cancellation"
        placeholder="Why is this trip being cancelled?"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mb-4"
      />

      <div className="flex flex-col gap-2">
        <Button
          full
          variant="danger"
          loading={submitting}
          disabled={!note.trim() || submitting}
          onClick={submit}
        >
          {submitting ? 'Cancelling…' : 'Cancel trip'}
        </Button>
        <Button variant="secondary" full onClick={close} disabled={submitting}>
          Keep trip active
        </Button>
      </div>
    </Modal>
  )
}
