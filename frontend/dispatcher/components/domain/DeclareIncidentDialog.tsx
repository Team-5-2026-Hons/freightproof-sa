'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TextArea } from '@/components/ui/TextArea'
import { useToast } from '@/lib/hooks/useToast'
import { ApiError } from '@/lib/api/client'
import { recordIncidentDeclaration } from '@/lib/api/auditPacks'
import { sastInputToIso } from '@/lib/format/sast'

interface Props {
  tripId: string
  open: boolean
  onClose: () => void
  onDeclared: () => void
}

const TEXT_FIELDS = ['saps_station', 'saps_cas_number', 'saps_officer', 'insurer_claim_reference', 'note'] as const
const TIME_FIELDS = ['reported_to_saps_at', 'tracking_company_notified_at', 'client_notified_at', 'insurer_notified_at'] as const
type Draft = Record<(typeof TEXT_FIELDS)[number] | (typeof TIME_FIELDS)[number], string>

const EMPTY: Draft = {
  saps_station: '', saps_cas_number: '', saps_officer: '', insurer_claim_reference: '', note: '',
  reported_to_saps_at: '', tracking_company_notified_at: '', client_notified_at: '', insurer_notified_at: '',
}

/**
 * Records what a claim form asks for that FreightProof never captured: the SAPS station
 * and case number, and when each party was told. Append-only — saving again adds a new
 * declaration rather than editing the old one, so the record of what was said stands.
 */
export function DeclareIncidentDialog({ tripId, open, onClose, onDeclared }: Props) {
  const { notify } = useToast()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null
  const declaresSomething = Object.entries(draft).some(([key, value]) => key !== 'note' && value.trim() !== '')

  function set(key: keyof Draft, value: string) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function close() {
    if (submitting) return
    setDraft(EMPTY)
    onClose()
  }

  async function submit() {
    if (!declaresSomething || submitting) return
    setSubmitting(true)
    try {
      await recordIncidentDeclaration(tripId, {
        exception_id: null,
        ...Object.fromEntries(TEXT_FIELDS.map(key => [key, draft[key].trim() || null])),
        ...Object.fromEntries(TIME_FIELDS.map(key => [key, sastInputToIso(draft[key])])),
      } as Parameters<typeof recordIncidentDeclaration>[1])
      notify({ kind: 'success', title: 'Police and notification details recorded' })
      setDraft(EMPTY)
      onDeclared()
      onClose()
    } catch (err) {
      notify({ kind: 'error', title: err instanceof ApiError && err.status === 422 ? 'Check the details and try again.' : 'Could not record the details. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} closeDisabled={submitting} title="Record police & notification details">
      <p className="mb-4 text-[13px] leading-relaxed text-on-surf-v">
        These appear in audit packs marked <strong>Declared</strong> — entered by you after the event, not captured by
        FreightProof. Times are South African time. Saving again adds a correction; nothing is overwritten.
      </p>
      <div className="flex flex-col gap-3">
        <Input label="SAPS station" value={draft.saps_station} onChange={e => set('saps_station', e.target.value)} />
        <Input label="Case (CAS) number" value={draft.saps_cas_number} onChange={e => set('saps_cas_number', e.target.value)} />
        <Input label="Investigating officer" value={draft.saps_officer} onChange={e => set('saps_officer', e.target.value)} />
        <Input label="Reported to SAPS at" type="datetime-local" value={draft.reported_to_saps_at} onChange={e => set('reported_to_saps_at', e.target.value)} />
        <Input label="Tracking company notified at" type="datetime-local" value={draft.tracking_company_notified_at} onChange={e => set('tracking_company_notified_at', e.target.value)} />
        <Input label="Client notified at" type="datetime-local" value={draft.client_notified_at} onChange={e => set('client_notified_at', e.target.value)} />
        <Input label="Insurer notified at" type="datetime-local" value={draft.insurer_notified_at} onChange={e => set('insurer_notified_at', e.target.value)} />
        <Input label="Insurer claim reference" value={draft.insurer_claim_reference} onChange={e => set('insurer_claim_reference', e.target.value)} />
        <TextArea label="Note (optional)" value={draft.note} onChange={e => set('note', e.target.value)} />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button full loading={submitting} disabled={!declaresSomething || submitting} onClick={submit}>Save details</Button>
        <Button variant="secondary" full onClick={close} disabled={submitting}>Cancel</Button>
      </div>
    </Modal>
  )
}
