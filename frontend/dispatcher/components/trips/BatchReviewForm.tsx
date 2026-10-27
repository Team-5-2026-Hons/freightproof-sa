'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { NO_CONTACT_CHOSEN, NO_OUTCOME_CHOSEN, ReviewFields } from '@/components/domain/ReviewFields'
import { ApiError, reviewExceptionBatch } from '@/lib/api/client'
import { EXCEPTION_BATCH_LIMIT } from '@/lib/exceptions/queue'
import { fmtExceptionType, fmtExceptionRaised } from '@/lib/format/exception'
import { useToast } from '@/lib/hooks/useToast'
import type { DispatcherReviewOutcome, ExceptionContactMethod, TripException } from '@shared/lib/types/exception'

const CONFLICT_TOAST_TITLE = 'A colleague got there first'

interface Props {
  tripId: string
  exceptions: TripException[]
  excludedCount?: number
  onDone: () => void
  onCancel: () => void
}

/** One note and outcome applied to a trip's non-critical, unreviewed exceptions. */
export function BatchReviewForm({ tripId, exceptions: liveExceptions, excludedCount: liveExcludedCount = 0, onDone, onCancel }: Props) {
  const { notify } = useToast()
  const [exceptions] = useState(liveExceptions)
  const [excludedCount] = useState(liveExcludedCount)
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN>(NO_OUTCOME_CHOSEN)
  const [contact, setContact] = useState<ExceptionContactMethod | typeof NO_CONTACT_CHOSEN>(NO_CONTACT_CHOSEN)
  const [busy, setBusy] = useState(false)

  const count = exceptions.length
  const noun = count === 1 ? 'exception' : 'exceptions'
  const typeCounts = new Map<string, number>()
  for (const x of exceptions) typeCounts.set(fmtExceptionType(x.exception_type), (typeCounts.get(fmtExceptionType(x.exception_type)) ?? 0) + 1)
  const summary = [...typeCounts].map(([label, n]) => `${label} × ${n}`).join(' · ')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedNote = note.trim()
    if (!trimmedNote || outcome === NO_OUTCOME_CHOSEN || busy || count > EXCEPTION_BATCH_LIMIT) return
    setBusy(true)
    try {
      await reviewExceptionBatch({
        trip_id: tripId,
        exception_ids: exceptions.map(x => x.id),
        review_note: trimmedNote,
        review_outcome: outcome,
        contact_method: contact || null,
      })
      notify({ kind: 'success', title: `${count} ${noun} reviewed` })
      onDone()
    } catch (err) {
      const lostTheRace = err instanceof ApiError && err.status === 409
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
        <p className="text-sm font-semibold text-on-surf">Review {count} {noun} with one note</p>
        <p className="mt-1 text-xs text-on-surf-v">These {count} {noun} get the same outcome and note. Anything raised after you opened this is not included.</p>
        <p className="mt-2 text-sm text-on-surf">{summary}</p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-sec">Show all {count}</summary>
          <ul className="mt-2 space-y-1 text-on-surf-v">
            {exceptions.map(x => <li key={x.id}>{fmtExceptionType(x.exception_type)} · {fmtExceptionRaised(x.created_at)}</li>)}
          </ul>
        </details>
        {excludedCount > 0 && <p className="mt-2 text-xs text-on-surf-v">
          {excludedCount} other unreviewed {excludedCount === 1 ? 'record is' : 'records are'} not included: critical, or claimed by a colleague.
        </p>}
      </div>
      <ReviewFields idPrefix={`batch-${tripId}`}
        note={note}       onNote={setNote}
        outcome={outcome} onOutcome={setOutcome}
        contact={contact} onContact={setContact}
      />
      <p role="status" className="text-xs text-on-surf-v">{busy ? 'Submitting assessment…' : count > EXCEPTION_BATCH_LIMIT ? `Narrow the batch to ${EXCEPTION_BATCH_LIMIT} records before reviewing.` : !note.trim() || !outcome ? 'Choose an outcome and enter a review note to submit.' : 'Ready to submit.'}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!note.trim() || outcome === NO_OUTCOME_CHOSEN || busy || count > EXCEPTION_BATCH_LIMIT}
          loading={busy}
          iconLeft={<Ic n="check" s={14} c="white" />}
        >
          Review {count} {noun}
        </Button>
      </div>
    </form>
  )
}
