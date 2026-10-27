'use client'

import { useId } from 'react'
import { Ic } from '@/components/ui/Ic'
import { FieldLabel, fieldClass } from '@/components/trips/new/form-parts'
import { COPY }   from '@shared/lib/constants/copy'
import type { DispatcherReviewOutcome, ExceptionContactMethod } from '@shared/lib/types/exception'

export const REVIEW_OUTCOME_LABELS: Record<DispatcherReviewOutcome, string> = {
  no_action_required:     'No action required',
  handled_externally:     'Handled externally',
  evidence_verified:      'Evidence verified',
  data_discrepancy:       'Data discrepancy',
  referred_for_follow_up: 'Referred for follow-up',
}

export const CONTACT_METHOD_LABELS: Record<ExceptionContactMethod, string> = {
  phone:     'Phoned the driver',
  whatsapp:  'WhatsApp',
  in_person: 'In person',
}

export const NO_OUTCOME_CHOSEN = '' as const
export const NO_CONTACT_CHOSEN = '' as const

export interface ReviewFieldsProps {
  idPrefix?: string
  note: string
  onNote: (value: string) => void
  outcome: DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN
  onOutcome: (value: DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN) => void
  contact: ExceptionContactMethod | typeof NO_CONTACT_CHOSEN
  onContact: (value: ExceptionContactMethod | typeof NO_CONTACT_CHOSEN) => void
}

/** Native select in the same filled, underlined skin as the trip creation form, so the
 *  review form no longer carries its own heavier boxed borders. */
function ReviewSelect({ id, label, required = false, value, onChange, children }: {
  id: string; label: string; required?: boolean; value: string
  onChange: (value: string) => void; children: React.ReactNode
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <select id={id} required={required} value={value} onChange={e => onChange(e.target.value)}
          className={`${fieldClass(false)} min-h-[44px] appearance-none pr-9`}>
          {children}
        </select>
        <Ic n="chev" s={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
      </div>
    </div>
  )
}

/** The three review inputs, shared by the exception detail page and the trip-level batch
 *  review so the two can never word or validate the same fields differently. */
export function ReviewFields({
  note, onNote, outcome, onOutcome, contact, onContact, idPrefix,
}: ReviewFieldsProps) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  return (
    <div className="contents">
      <ReviewSelect id={`${prefix}-outcome`} label="Outcome (required)" required value={outcome}
        onChange={value => onOutcome(value as DispatcherReviewOutcome | typeof NO_OUTCOME_CHOSEN)}>
        <option value={NO_OUTCOME_CHOSEN} disabled>
          {COPY.confirm.reviewOutcomeUnset}
        </option>
        {(Object.keys(REVIEW_OUTCOME_LABELS) as DispatcherReviewOutcome[]).map(o => (
          <option key={o} value={o}>
            {REVIEW_OUTCOME_LABELS[o]}
          </option>
        ))}
      </ReviewSelect>
      <div>
        <FieldLabel htmlFor={`${prefix}-note`}>Review note (required)</FieldLabel>
        <textarea id={`${prefix}-note`} required rows={4} aria-describedby={`${prefix}-note-help`} placeholder={COPY.confirm.reviewNote} value={note} onChange={e => onNote(e.target.value)}
          className={`${fieldClass(false)} min-h-28 resize-y py-3 leading-relaxed placeholder:text-on-surf-v/60`} />
        <p id={`${prefix}-note-help`} className="mt-1 text-xs text-on-surf-v">Record what you checked and why you chose this outcome.</p>
      </div>
      <ReviewSelect id={`${prefix}-contact`} label="Contact method (optional)" value={contact}
        onChange={value => onContact(value as ExceptionContactMethod | typeof NO_CONTACT_CHOSEN)}>
        <option value={NO_CONTACT_CHOSEN}>No contact, reviewed from evidence alone</option>
        {(Object.keys(CONTACT_METHOD_LABELS) as ExceptionContactMethod[]).map(m => (
          <option key={m} value={m}>
            {CONTACT_METHOD_LABELS[m]}
          </option>
        ))}
      </ReviewSelect>
    </div>
  )
}
