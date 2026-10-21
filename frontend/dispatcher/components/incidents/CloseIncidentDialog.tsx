'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { OUTCOME_LABELS } from '@/lib/format/incident'
import type { IncidentOutcome, IncidentParcel } from '@/lib/types/incident'

interface Props {
  open: boolean
  /** Parcels with no finding yet; closing leaves them unresolved, which is allowed. */
  unresolved: IncidentParcel[]
  /** A SAPS case number is on record for this incident (or its trip). */
  hasCaseNumber: boolean
  onClose: () => void
  onRecordCase: () => void
  onSubmit: (outcome: IncidentOutcome, reason: string) => Promise<boolean>
}

const OUTCOMES = Object.keys(OUTCOME_LABELS) as IncidentOutcome[]

/**
 * Closing says what the investigation established and why. It never requires the cargo to
 * have been found: "inconclusive", and parcels left unresolved, are honest ways to end. Theft
 * reported with no case number is allowed too, but warned about, and the audit pack says so.
 */
export function CloseIncidentDialog(props: Props): React.JSX.Element | null {
  if (!props.open) return null
  return <CloseIncidentForm {...props} />
}

function CloseIncidentForm({ unresolved, hasCaseNumber, onClose, onRecordCase, onSubmit }: Props): React.JSX.Element {
  const [outcome, setOutcome] = useState<IncidentOutcome>('inconclusive')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const theftWithoutCase = outcome === 'theft_reported' && !hasCaseNumber

  async function save(): Promise<void> {
    if (!reason.trim() || saving) return
    setSaving(true)
    try {
      if (await onSubmit(outcome, reason.trim())) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose() }} closeDisabled={saving} title="Close incident">
      <div className="flex flex-col gap-3">
        <Select label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value as IncidentOutcome)}>
          {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
        </Select>
        {theftWithoutCase && (
          <div role="alert" className="rounded-md bg-warn-c px-3 py-2 text-sm text-warn-onc">
            No SAPS case number is recorded, and the audit pack will say so.
            <button type="button" onClick={onRecordCase} className="ml-1 font-semibold underline">Record it first</button>
          </div>
        )}
        <TextArea label="What was established" value={reason} onChange={e => setReason(e.target.value)} />
        {unresolved.length > 0 && (
          <p className="text-xs leading-relaxed text-on-surf-v">
            {unresolved.length} parcel{unresolved.length === 1 ? '' : 's'} will stay unresolved:{' '}
            <span className="tabular-nums">{unresolved.map(p => p.barcode).join(', ')}</span>. The audit pack lists them as unresolved.
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button full loading={saving} disabled={!reason.trim() || saving} onClick={save}>Close incident</Button>
        <Button variant="secondary" full onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  )
}
