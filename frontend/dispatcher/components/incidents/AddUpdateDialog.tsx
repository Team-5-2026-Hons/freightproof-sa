'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { sastInputToIso } from '@/lib/format/sast'
import { CONFIDENCE_HELP, CONFIDENCE_LABELS, EXTERNAL_ACTION_LABELS } from '@/lib/format/incident'
import type { IncidentConfidence, IncidentExternalAction, IncidentUpdateCreate } from '@/lib/types/incident'

export type UpdateMode = 'note' | 'external_action' | 'confidence_changed'

interface Props {
  open: boolean
  initialMode?: UpdateMode
  initialAction?: IncidentExternalAction
  currentConfidence: IncidentConfidence
  onClose: () => void
  /** Resolves true when the entry was recorded, so the dialog can close. */
  onSubmit: (update: IncidentUpdateCreate) => Promise<boolean>
}

const MODE_LABELS: Record<UpdateMode, string> = {
  note: 'Note',
  external_action: 'Something done outside FreightProof',
  confidence_changed: 'Change confidence',
}

/** Appends one entry to the incident's ledger. Nothing earlier is changed by it. */
export function AddUpdateDialog(props: Props): React.JSX.Element | null {
  if (!props.open) return null
  return <AddUpdateForm {...props} />
}

function AddUpdateForm({ initialMode = 'note', initialAction = 'tracking_company_alerted', currentConfidence, onClose, onSubmit }: Props): React.JSX.Element {
  const [mode, setMode] = useState<UpdateMode>(initialMode)
  const [note, setNote] = useState('')
  const [action, setAction] = useState<IncidentExternalAction>(initialAction)
  const [actionAt, setActionAt] = useState('')
  const [confidence, setConfidence] = useState<IncidentConfidence>(currentConfidence)
  const [saving, setSaving] = useState(false)

  const trimmed = note.trim()
  const missing = mode === 'note' && !trimmed ? 'Write the note.'
    : mode === 'confidence_changed' && confidence === currentConfidence ? 'Choose a different confidence.'
      : mode === 'confidence_changed' && !trimmed ? 'Say what changed your confidence.'
        : mode === 'external_action' && action === 'other' && !trimmed ? 'Describe the action.'
          : null

  function build(): IncidentUpdateCreate {
    switch (mode) {
      case 'note': return { kind: 'note', note: trimmed }
      case 'external_action': return { kind: 'external_action', action, action_at: sastInputToIso(actionAt), note: trimmed || null }
      case 'confidence_changed': return { kind: 'confidence_changed', confidence, note: trimmed }
    }
  }

  async function save(): Promise<void> {
    if (missing || saving) return
    setSaving(true)
    try {
      if (await onSubmit(build())) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose() }} closeDisabled={saving} title="Add to the incident">
      <div className="flex flex-col gap-3">
        <Select label="What to record" value={mode} onChange={e => setMode(e.target.value as UpdateMode)}>
          {(Object.keys(MODE_LABELS) as UpdateMode[]).map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </Select>
        {mode === 'external_action' && <>
          <Select label="Action" value={action} onChange={e => setAction(e.target.value as IncidentExternalAction)}>
            {(Object.keys(EXTERNAL_ACTION_LABELS) as IncidentExternalAction[]).map(a => <option key={a} value={a}>{EXTERNAL_ACTION_LABELS[a]}</option>)}
          </Select>
          <Input label="When it happened" type="datetime-local" helperText="Leave blank if it happened just now." value={actionAt} onChange={e => setActionAt(e.target.value)} />
          <p className="text-xs leading-relaxed text-on-surf-v">FreightProof records that this was done. It does not contact anyone.</p>
        </>}
        {mode === 'confidence_changed' && (
          <Select label="Confidence" value={confidence} helperText={CONFIDENCE_HELP[confidence]} onChange={e => setConfidence(e.target.value as IncidentConfidence)}>
            {(Object.keys(CONFIDENCE_LABELS) as IncidentConfidence[]).map(c => <option key={c} value={c}>{CONFIDENCE_LABELS[c]}</option>)}
          </Select>
        )}
        <TextArea label={mode === 'note' ? 'Note' : mode === 'confidence_changed' ? 'What changed it' : 'Note (optional)'} value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {missing && <p className="text-xs text-on-surf-v" role="status">{missing}</p>}
        <Button full loading={saving} disabled={missing !== null || saving} onClick={save}>Add entry</Button>
        <Button variant="secondary" full onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  )
}
