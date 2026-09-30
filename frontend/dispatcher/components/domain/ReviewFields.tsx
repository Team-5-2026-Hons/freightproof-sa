'use client'

import { Input }  from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { COPY }   from '@shared/lib/constants/copy'
import type { DispatcherReviewOutcome, ExceptionContactMethod } from '@shared/lib/types/exception'

// Labels for the 5 real, submittable review outcomes — mirrors the old resolve-flow
// file's RESOLUTION_METHOD_LABELS pattern (a plain Record so a missing case is a
// compile error, not a silently-blank option).
export const REVIEW_OUTCOME_LABELS: Record<DispatcherReviewOutcome, string> = {
  no_action_required:     'No action required',
  handled_externally:     'Handled externally',
  evidence_verified:      'Evidence verified',
  data_discrepancy:       'Data discrepancy',
  referred_for_follow_up: 'Referred for follow-up',
}

// Reused verbatim from the old resolve-flow file's CONTACT_METHOD_LABELS — these already
// read correctly, and the review endpoint's ExceptionContactMethod is the exact same
// three values.
export const CONTACT_METHOD_LABELS: Record<ExceptionContactMethod, string> = {
  phone:     'Phoned the driver',
  whatsapp:  'WhatsApp',
  in_person: 'In person',
}

// The outcome field's unselected state — a placeholder, never a real value, so the
// option is rendered `disabled` below and can never be submitted.
export const NO_OUTCOME_CHOSEN = '' as const
// The contact-method field's blank state — NOT a placeholder. Unlike the outcome above,
// leaving this blank is a genuine, submittable answer ("no contact happened, reviewed
// from evidence alone"), so its option is deliberately not disabled.
export const NO_CONTACT_CHOSEN = '' as const

export interface ReviewFieldsProps {
  note: string
  onNote: (value: string) => void
  outcome: DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN
  onOutcome: (value: DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN) => void
  contact: ExceptionContactMethod | typeof NO_CONTACT_CHOSEN
  onContact: (value: ExceptionContactMethod | typeof NO_CONTACT_CHOSEN) => void
}

/** The three review inputs, shared by the exception detail page and the trip-level batch
 *  review so the two can never word or validate the same fields differently. */
export function ReviewFields({
  note, onNote, outcome, onOutcome, contact, onContact,
}: ReviewFieldsProps) {
  return (
    <>
      <Input
        label="Review note"
        placeholder={COPY.confirm.reviewNote}
        value={note}
        onChange={e => onNote(e.target.value)}
      />
      <Select
        label="Outcome"
        value={outcome}
        onChange={e => onOutcome(e.target.value as DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN)}
      >
        <option value={NO_OUTCOME_CHOSEN} disabled>
          {COPY.confirm.reviewOutcomeUnset}
        </option>
        {(Object.keys(REVIEW_OUTCOME_LABELS) as DispatcherReviewOutcome[]).map(o => (
          <option key={o} value={o}>
            {REVIEW_OUTCOME_LABELS[o]}
          </option>
        ))}
      </Select>
      {/* Optional. Blank is a real, submittable answer here — not a placeholder — so its
          option is not `disabled`, unlike the outcome field above. */}
      <Select
        label="Contact method"
        value={contact}
        onChange={e => onContact(e.target.value as ExceptionContactMethod | typeof NO_CONTACT_CHOSEN)}
      >
        <option value={NO_CONTACT_CHOSEN}>No contact — reviewed from evidence alone</option>
        {(Object.keys(CONTACT_METHOD_LABELS) as ExceptionContactMethod[]).map(m => (
          <option key={m} value={m}>
            {CONTACT_METHOD_LABELS[m]}
          </option>
        ))}
      </Select>
    </>
  )
}
