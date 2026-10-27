'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'

interface Props {
  open: boolean
  onClose: () => void
  /** Resolves true when the document was stored, so the dialog can close. */
  onSubmit: (file: File, note: string) => Promise<boolean>
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic'

/** Attach a document (a SAPS case slip, a client letter). Rendered only while the backend's
 *  INCIDENT_DOCUMENTS_ENABLED is on; the incident read says so. */
export function AttachDocumentDialog(props: Props): React.JSX.Element | null {
  if (!props.open) return null
  return <AttachDocumentForm {...props} />
}

function AttachDocumentForm({ onClose, onSubmit }: Props): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    if (!file || !note.trim() || saving) return
    setSaving(true)
    try {
      if (await onSubmit(file, note.trim())) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose() }} closeDisabled={saving} title="Attach a document">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-on-surf-v">File (PDF or photo)</span>
          <input type="file" accept={ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <TextArea label="What this document is" value={note} onChange={e => setNote(e.target.value)} />
        <p className="text-xs leading-relaxed text-on-surf-v">
          Stored with its SHA-256 hash on this trip&apos;s evidence. Only dispatchers can see it; the driver&apos;s app cannot.
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button full loading={saving} disabled={!file || !note.trim() || saving} onClick={save}>Attach document</Button>
        <Button variant="secondary" full onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  )
}
