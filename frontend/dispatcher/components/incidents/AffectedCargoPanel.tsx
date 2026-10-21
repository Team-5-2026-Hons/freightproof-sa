'use client'

import { useState } from 'react'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { FINDING_LABELS, SCAN_STATE_LABELS } from '@/lib/format/incident'
import type { IncidentParcel, ParcelFinding } from '@/lib/types/incident'

interface Props {
  parcels: IncidentParcel[]
  closed: boolean
  onRecordFinding: (parcelId: string, finding: ParcelFinding, note: string) => Promise<boolean>
}

const FINDINGS = Object.keys(FINDING_LABELS) as ParcelFinding[]

/**
 * The parcels the incident names, each with two separate facts: what the scans recorded, and
 * what the dispatcher has established. "No scan-in recorded" is the first kind — it never
 * becomes "missing" until a finding says so, with its reason.
 */
export function AffectedCargoPanel({ parcels, closed, onRecordFinding }: Props): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const unresolved = parcels.filter(p => p.latest_finding === null).length

  if (parcels.length === 0) {
    return <p className="text-sm text-on-surf-v">No parcels named yet.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-on-surf-v">
        {parcels.length} parcel{parcels.length === 1 ? '' : 's'} named · {unresolved === 0 ? 'every finding recorded' : `${unresolved} not yet established`}
      </p>
      <ul className="divide-y divide-outline-v/30 rounded-md border border-outline-v/30">
        {parcels.map(p => (
          <li key={p.parcel_id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold tabular-nums text-on-surf">{p.barcode}</p>
                <p className="text-xs text-on-surf-v">
                  {p.consignment_reference ?? 'Consignment'}{p.delivery_stop ? ` · ${p.delivery_stop}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded-sm bg-surf-low px-2 py-1 text-on-surf-v" title={scanTitle(p)}>{SCAN_STATE_LABELS[p.scan_state]}</span>
                <span className={p.latest_finding ? 'font-semibold text-on-surf' : 'text-on-surf-v'}>
                  {p.latest_finding ? FINDING_LABELS[p.latest_finding] : 'Not established'}
                </span>
                {!closed && editing !== p.parcel_id && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p.parcel_id)}>Record finding</Button>
                )}
              </div>
            </div>
            {editing === p.parcel_id && (
              <FindingForm
                barcode={p.barcode}
                onCancel={() => setEditing(null)}
                onSave={async (finding, note) => {
                  if (await onRecordFinding(p.parcel_id, finding, note)) setEditing(null)
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function scanTitle(p: IncidentParcel): string {
  const out = p.scanned_out_at ? `Scanned out ${fmtSastDateTime(p.scanned_out_at)}` : 'No scan-out recorded'
  const into = p.scanned_in_at ? `scanned in ${fmtSastDateTime(p.scanned_in_at)}` : 'no scan-in recorded'
  return `${out}; ${into}`
}

interface FindingFormProps {
  barcode: string
  onCancel: () => void
  onSave: (finding: ParcelFinding, note: string) => Promise<void>
}

function FindingForm({ barcode, onCancel, onSave }: FindingFormProps): React.JSX.Element {
  const [finding, setFinding] = useState<ParcelFinding>('located')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await onSave(finding, note.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md bg-surf-low p-3">
      <Select label={`Finding for ${barcode}`} value={finding} onChange={e => setFinding(e.target.value as ParcelFinding)}>
        {FINDINGS.map(f => <option key={f} value={f}>{FINDING_LABELS[f]}</option>)}
      </Select>
      <TextArea label="How this was established" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" loading={saving} disabled={!note.trim() || saving} onClick={save}>Save finding</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}
