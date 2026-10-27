'use client'

import { useState } from 'react'
import type { Driver } from '@shared/lib/types/driver'
import type { SubstitutionErrorCode, SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import { arrangeSubstitution, newClientRequestId, replaceSubstitution, substitutionErrorCode } from '@/lib/api/driverSubstitutions'

const CODE_HINT: Partial<Record<SubstitutionErrorCode, string>> = {
  SUBSTITUTIONS_DISABLED: 'New handovers are switched off right now. Your details are kept; existing handovers still work.',
  DRIVER_UNAVAILABLE: 'That driver is committed to another trip then. Choose another eligible driver.',
  INCOMING_DRIVER_INACTIVE: 'That driver’s account is not active. Choose an eligible driver.',
  LICENCE_INVALID: 'That driver’s licence expiry is missing or has passed.',
  SUBSTITUTION_VERSION_CHANGED: 'Someone else changed this handover. Close and reopen it to see the latest.',
  SUBSTITUTION_NOT_PENDING: 'This handover is no longer pending.',
}

interface Draft {
  incomingDriverId: string
  reason: string
  replacementReason: string
}

const EMPTY: Draft = { incomingDriverId: '', reason: '', replacementReason: '' }

interface Props {
  tripId: string
  outgoingDriverName?: string
  open: boolean
  drivers: Driver[]
  replacing?: SubstitutionRequestRead | null
  onClose: () => void
  onSaved: (request: SubstitutionRequestRead) => void
}

/**
 * Authorise an immediate transfer, or explicitly replace a legacy request with a fresh v2
 * request. A refusal keeps the draft and its request key, so retry never duplicates an action.
 */
function initialDraft(replacing: SubstitutionRequestRead | null): Draft {
  return replacing ? { ...EMPTY, incomingDriverId: replacing.incoming.id, reason: replacing.reason } : EMPTY
}

/** The caller mounts this afresh for each opening (and each request it replaces). */
export function DriverSubstitutionDialog({ tripId, outgoingDriverName, open, drivers, replacing = null, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(replacing))
  const [submitting, setSubmitting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId)

  if (!open) return null

  const complete = draft.incomingDriverId !== '' && draft.reason.trim() !== ''
    && (!replacing || draft.replacementReason.trim() !== '')

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
    setClientRequestId(newClientRequestId())
    setProblem(null)
  }

  function close() {
    if (submitting) return
    setDraft(EMPTY)
    setProblem(null)
    onClose()
  }

  async function submit() {
    if (!complete || submitting) return
    setSubmitting(true)
    const fields = {
      client_request_id: clientRequestId, request_format: 'immediate_v2' as const, incoming_driver_id: draft.incomingDriverId, reason: draft.reason.trim(),
    }
    try {
      const saved = replacing
        ? await replaceSubstitution(tripId, replacing.id, {
          ...fields, expected_version: replacing.version, replacement_reason: draft.replacementReason.trim(),
        })
        : await arrangeSubstitution(tripId, fields)
      setDraft(EMPTY)
      setClientRequestId(newClientRequestId())
      onSaved(saved)
    } catch (err) {
      const code = substitutionErrorCode(err)
      const hint = code ? CODE_HINT[code] : undefined
      setProblem(hint ?? (err instanceof ApiError ? err.message : 'Could not save the handover.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title={replacing ? 'Replace driver handover' : 'Transfer driver'} size="md" closeDisabled={submitting}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={submitting}>Cancel</Button>
        <Button onClick={submit} loading={submitting} disabled={!complete}>{replacing ? 'Replace handover' : 'Authorise transfer'}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 text-[13px] text-on-surf-v">
          Hand this trip to another driver.
          <InfoPopover title="How a transfer works" ariaLabel="How a transfer works" question="How a transfer works"
            basis="The trip keeps its original record. You authorise the transfer, and the incoming driver accepts it using their takeover checks."
            note="The outgoing driver is notified."
            footnote="Custody changes only when the server completes it." />
        </div>
        <Input label="Outgoing driver" value={outgoingDriverName ?? replacing?.outgoing.full_name ?? 'Current driver'} readOnly />
        <Select label="Incoming driver" value={draft.incomingDriverId} onChange={e => set('incomingDriverId', e.target.value)}>
          <option value="">Choose a driver</option>
          {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
        </Select>
        <TextArea label="Reason" value={draft.reason} maxLength={1000} onChange={e => set('reason', e.target.value)} />
        {replacing && (
          <TextArea label="Why replace the current arrangement" value={draft.replacementReason} maxLength={1000}
            onChange={e => set('replacementReason', e.target.value)} />
        )}
        {problem && <p role="alert" className="text-[13px] text-err">{problem}</p>}
      </div>
    </Modal>
  )
}
