'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { TextArea } from '@/components/ui/TextArea'
import { useToast } from '@/lib/hooks/useToast'
import { overridePhase, ApiError } from '@/lib/api/client'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'

interface Props {
  phase: PhaseDescriptor
  tripId: string
  tripStatus: Trip['status']
  // Runs after a successful override; the caller re-syncs the trip and
  // PhaseOverrideSection picks up the resulting note/user from the refreshed phase.
  onOverridden: () => void
}

// Mirrors the backend's gate in override_phase (phase_service.py): a completed/
// exception/overridden row is resolved evidence and must never look rewritable.
const OVERRIDABLE_STATUSES: readonly PhaseDescriptor['status'][] = ['pending', 'in_progress']

// A terminal trip is not overridable either — mirrors CancelTripAction's TERMINAL_STATUSES.
const TERMINAL_TRIP_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

// Deliberate asymmetry: activation is never overridable from this UI (even though the
// backend permits it) — the honest action for a trip never activated is to CANCEL it.

/**
 * The dispatcher's entry point for recording that the driver physically could not
 * complete a phase. Deliberately not a claim that the phase happened — this becomes the
 * permanent audit record PhaseOverrideSection renders for the life of the trip.
 */
export function PhaseOverrideAction({ phase, tripId, tripStatus, onOverridden }: Props) {
  const { notify } = useToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (TERMINAL_TRIP_STATUSES.includes(tripStatus)) return null
  if (!OVERRIDABLE_STATUSES.includes(phase.status)) return null

  const phaseName = PHASE_NAMES[phase.phase_type]

  function close() {
    if (submitting) return
    setOpen(false)
    setNote('')
  }

  async function submit() {
    if (submitting || !note.trim()) return
    setSubmitting(true)
    try {
      await overridePhase(tripId, phase.phase_event_id, note.trim())
      notify({ kind: 'success', title: `${phaseName} recorded as unable to complete` })
      setOpen(false)
      setNote('')
      onOverridden()
    } catch (err) {
      // 404/409 carry the backend's own accurate reason (str(exc) in trip_admin.py).
      const title =
        err instanceof ApiError && (err.status === 404 || err.status === 409) ? err.message
        : err instanceof ApiError && err.status === 422 ? 'A note is required.'
        : 'Failed to record the override. Please try again.'
      notify({ kind: 'error', title })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-[6px] text-[11px] font-[600] text-warn hover:opacity-75 transition-opacity"
      >
        <Ic n="warn" s={12} className="text-warn" />
        Record as unable to complete
      </button>

      <Modal open={open} onClose={close} closeDisabled={submitting} title={`Record ${phaseName} as unable to complete`}>
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-[2px] shrink-0 rounded-full bg-warn-c p-[6px]">
                <Ic n="warn" s={16} className="text-warn" />
              </div>
              <div>
                <div className="text-[13px] text-on-surf-v mt-[4px] leading-relaxed">
                  This does not mark {phaseName.toLowerCase()} as done — it records that the
                  driver could not complete it (lost phone, left the depot, device wiped),
                  so the trip can move past it. The gap stays on the evidence record
                  permanently, alongside your note.
                </div>
              </div>
            </div>

            <TextArea
              label="Note"
              placeholder="Why couldn't the driver complete this phase?"
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
                {submitting ? 'Recording…' : 'Record override'}
              </Button>
              <Button variant="secondary" full onClick={close} disabled={submitting}>
                Go back
              </Button>
            </div>
      </Modal>
    </div>
  )
}
