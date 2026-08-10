'use client'

import { useState } from 'react'
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
  // Runs after a successful override — the caller re-syncs the trip (silent refetch);
  // PhaseOverrideSection then picks up the resulting note/user from the refreshed phase,
  // so this component never renders that state itself.
  onOverridden: () => void
}

// Mirrors the backend's own gate in override_phase (phase_service.py): only a row still
// PENDING or IN_PROGRESS can be overridden. A completed/exception/overridden row is
// resolved evidence and must never look rewritable — hiding the control here, rather than
// leaving it to a 409, is what keeps that true on screen as well as on the wire.
const OVERRIDABLE_STATUSES: readonly PhaseDescriptor['status'][] = ['pending', 'in_progress']

// A terminal trip is not overridable either, and this is not merely cosmetic. cancel_trip
// leaves every phase row PENDING on purpose (the honest record of an abandoned plan), so
// without this check a cancelled trip's rows would still offer the control — and the
// backend's own guard would 409 every time. Mirrors CancelTripAction's TERMINAL_STATUSES.
const TERMINAL_TRIP_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

// Known and deliberate asymmetry: the trip detail page only mounts expandedContent for
// the phase currently blocking the plan, and derive.ts pins `activation` to 'pending'
// while the trip is still `created` — so activation is never overridable from this UI,
// even though the backend permits it.
//
// That is the intended product behaviour, not an oversight. Overriding an activation
// would assert the trip started when no driver ever touched it; the honest action for a
// trip that was never activated is to CANCEL it, which is offered on the same screen.
// The backend keeps the capability (and a test for it) because the API is the general
// case; the UI deliberately surfaces only the narrower one.

/**
 * The dispatcher's entry point for the one release valve a stuck phase has: recording
 * that the driver physically could not complete it (lost phone, left the depot, device
 * wiped). This is deliberately NOT a claim that the phase happened — the copy below has
 * to hold that line, because the note captured here becomes the permanent audit record
 * PhaseOverrideSection renders for as long as this trip exists.
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
    if (!note.trim()) return
    setSubmitting(true)
    try {
      await overridePhase(tripId, phase.phase_event_id, note.trim())
      notify({ kind: 'success', title: `${phaseName} recorded as unable to complete` })
      setOpen(false)
      setNote('')
      onOverridden()
    } catch (err) {
      // 404/409 carry the backend's own accurate reason (str(exc) in trip_admin.py) —
      // e.g. the row is no longer pending because the driver just completed it — which a
      // fixed title here would hide from the dispatcher.
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
              <div className="mt-[2px] shrink-0 rounded-full bg-warn-c p-[6px]">
                <Ic n="warn" s={16} className="text-warn" />
              </div>
              <div>
                <div className="text-[16px] font-[700] text-on-surf">
                  Record {phaseName} as unable to complete
                </div>
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
          </div>
        </div>
      )}
    </div>
  )
}
