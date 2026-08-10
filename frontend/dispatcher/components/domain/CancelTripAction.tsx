'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { TextArea } from '@/components/ui/TextArea'
import { useToast } from '@/lib/hooks/useToast'
import { cancelTrip, ApiError } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'

interface Props {
  tripId: string
  status: Trip['status']
  // Runs after a successful cancel — the caller re-syncs the trip (silent refetch),
  // since this component owns no trip state itself.
  onCancelled: () => void
}

// A trip that has already reached either terminal state has no further lifecycle
// action to take — cancelling a cancelled/closed trip is not a real choice, so the
// control is hidden rather than left to explain itself via a 409 from the backend.
const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

/**
 * The dispatcher's only way to end a trip abandoned mid-plan (cargo pulled, vehicle
 * broken down). This makes good on the promise the trip-creation wizard already states
 * up front: a trip can never be deleted, only cancelled — its phase rows and any
 * evidence already captured stay on the record exactly as they are.
 */
export function CancelTripAction({ tripId, status, onCancelled }: Props) {
  const { notify } = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (TERMINAL_STATUSES.includes(status)) return null

  function close() {
    if (submitting) return
    setOpen(false)
    setNote('')
  }

  async function submit() {
    if (!note.trim()) return
    setSubmitting(true)
    try {
      await cancelTrip(tripId, note.trim())
      notify({ kind: 'success', title: 'Trip cancelled' })
      setOpen(false)
      setNote('')
      onCancelled()
    } catch (err) {
      // 404/409 carry the backend's own accurate reason (str(exc) in trip_admin.py) —
      // e.g. "already cancelled" — which a fixed title here would flatten. 422 cannot
      // actually happen (submit is disabled on a blank note) but is named honestly
      // rather than falling into the generic branch if the client and server ever drift.
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
    <>
      <Button variant="danger" size="sm" full onClick={() => setOpen(true)}>
        Cancel trip
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-[440px] rounded-xl bg-surf-lowest shadow-xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-[2px] shrink-0 rounded-full bg-err-c p-[6px]">
                <Ic n="warn" s={16} className="text-err" />
              </div>
              <div>
                <div className="text-[16px] font-[700] text-on-surf">Cancel this trip?</div>
                <div className="text-[13px] text-on-surf-v mt-[4px] leading-relaxed">
                  This trip will be cancelled, never deleted — every phase and every piece
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
              autoFocus
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
          </div>
        </div>
      )}
    </>
  )
}
