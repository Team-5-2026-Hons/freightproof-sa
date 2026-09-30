'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { NO_CONTACT_CHOSEN, NO_OUTCOME_CHOSEN, ReviewFields } from '@/components/domain/ReviewFields'
import { ApiError, reviewExceptionBatch } from '@/lib/api/client'
import { fmtExceptionType } from '@/lib/format/exception'
import { useToast } from '@/lib/hooks/useToast'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { DispatcherReviewOutcome, ExceptionContactMethod, TripException } from '@shared/lib/types/exception'

// Same wording as the detail page, since it is the same situation: a colleague changed
// the row between this page loading and the press.
const CONFLICT_TOAST_TITLE = 'A colleague got there first'

interface Props {
  tripId: string
  /** The rows eligible when the form opens. The caller decides eligibility; the form
   *  snapshots them on mount and sends exactly those ids, so a warning raised while the
   *  dispatcher is typing is never swept into a review they did not see. */
  exceptions: TripException[]
  onDone: () => void
  onCancel: () => void
}

/** One note and outcome applied to a trip's non-critical, unreviewed exceptions. */
export function BatchReviewForm({ tripId, exceptions: liveExceptions, onDone, onCancel }: Props) {
  const { notify } = useToast()
  // Frozen at mount: the parent's list is live (realtime refetches), but what the
  // dispatcher confirms must be the list they read when they opened the form.
  const [exceptions] = useState(liveExceptions)
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN>(NO_OUTCOME_CHOSEN)
  const [contact, setContact] = useState<ExceptionContactMethod | typeof NO_CONTACT_CHOSEN>(NO_CONTACT_CHOSEN)
  const [busy, setBusy] = useState(false)

  const count = exceptions.length
  const noun = count === 1 ? 'exception' : 'exceptions'

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedNote = note.trim()
    // Both gates, as on the detail page: keyboard submit bypasses the disabled attribute.
    if (!trimmedNote || outcome === NO_OUTCOME_CHOSEN) return
    setBusy(true)
    try {
      await reviewExceptionBatch({
        trip_id: tripId,
        exception_ids: exceptions.map(x => x.id),
        review_note: trimmedNote,
        review_outcome: outcome,
        // Explicit null: the backend needs the key present to tell "no contact" from a
        // client that forgot the field.
        contact_method: contact || null,
      })
      notify({ kind: 'success', title: `${count} ${noun} reviewed` })
      // The mutation response carries no reviewer names; the trip page refetches through
      // its live subscription, so closing is all that is left to do.
      onDone()
    } catch (err) {
      const lostTheRace = err instanceof ApiError && err.status === 409
      // A 422 message is the server's own `detail` (e.g. a critical row slipped in), which
      // is more useful than a generic line. The note stays in the form either way.
      notify({
        kind: 'error',
        title: lostTheRace ? CONFLICT_TOAST_TITLE : 'Could not review these exceptions',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-4 rounded-lg border border-outline-v/30 bg-surf-lowest p-4">
      <div>
        <p className="text-sm font-bold text-on-surf">Review {count} {noun} with one note</p>
        <ul className="mt-2 space-y-1 text-xs text-on-surf-v">
          {exceptions.map(x => (
            <li key={x.id}>{fmtExceptionType(x.exception_type)} · {fmtDateTime(x.created_at)}</li>
          ))}
        </ul>
      </div>
      <ReviewFields
        note={note}       onNote={setNote}
        outcome={outcome} onOutcome={setOutcome}
        contact={contact} onContact={setContact}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          type="submit"
          variant="success"
          size="sm"
          disabled={!note.trim() || outcome === NO_OUTCOME_CHOSEN || busy}
          loading={busy}
          iconLeft={<Ic n="check" s={14} c="white" />}
        >
          Review {count} {noun}
        </Button>
      </div>
    </form>
  )
}
