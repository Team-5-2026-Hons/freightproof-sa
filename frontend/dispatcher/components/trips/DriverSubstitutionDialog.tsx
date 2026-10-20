'use client'

import { useState } from 'react'
import type { Driver } from '@shared/lib/types/driver'
import type { SubstitutionErrorCode, SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import { arrangeSubstitution, newClientRequestId, replaceSubstitution, substitutionErrorCode } from '@/lib/api/driverSubstitutions'
import { isoToSastInput, sastInputToIso } from '@/lib/format/sast'

// What the dispatcher can do about each refusal; the server's own message rides alongside.
const CODE_HINT: Partial<Record<SubstitutionErrorCode, string>> = {
  SUBSTITUTIONS_DISABLED: 'New handovers are switched off right now. Your details are kept; existing handovers still work.',
  DRIVER_UNAVAILABLE: 'That driver is committed to another trip then. Choose another driver or time.',
  INCOMING_DRIVER_INACTIVE: 'That driver’s account is not active. Choose an eligible driver.',
  LICENCE_INVALID: 'That driver’s licence expiry is missing or passes before the exchange.',
  SUBSTITUTION_VERSION_CHANGED: 'Someone else changed this handover. Close and reopen it to see the latest.',
  SUBSTITUTION_NOT_PENDING: 'This handover is no longer pending.',
}

interface Draft {
  incomingDriverId: string
  label: string
  latitude: string
  longitude: string
  instructions: string
  expectedAt: string
  isPlanned: boolean
  reason: string
  replacementReason: string
}

const EMPTY: Draft = {
  incomingDriverId: '', label: '', latitude: '', longitude: '', instructions: '', expectedAt: '', isPlanned: true,
  reason: '', replacementReason: '',
}

interface Props {
  tripId: string
  open: boolean
  /** Eligible candidates: the trip's own current driver is filtered out by the caller. */
  drivers: Driver[]
  /** Present to REPLACE this pending arrangement (a fresh request; nothing is edited in place). */
  replacing?: SubstitutionRequestRead | null
  onClose: () => void
  onSaved: (request: SubstitutionRequestRead) => void
}

/**
 * Arrange a driver handover, or replace a pending one. The exchange point is a named place
 * with coordinates and instructions the drivers will see; it is the PLANNED point, separate
 * from wherever the vehicle's tracker last reported. A refusal keeps the draft, including the
 * disabled-flag case, so nothing typed is lost.
 */
function initialDraft(replacing: SubstitutionRequestRead | null): Draft {
  if (!replacing) return EMPTY
  // A replacement starts from the arrangement it replaces, so only what changes is retyped.
  return {
    ...EMPTY, incomingDriverId: replacing.incoming.id, label: replacing.exchange.label,
    latitude: String(replacing.exchange.latitude), longitude: String(replacing.exchange.longitude),
    instructions: replacing.exchange.instructions ?? '', isPlanned: replacing.is_planned, reason: replacing.reason,
    expectedAt: isoToSastInput(replacing.expected_at),
  }
}

/** The caller mounts this afresh for each opening (and each request it replaces). */
export function DriverSubstitutionDialog({ tripId, open, drivers, replacing = null, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(replacing))
  const [submitting, setSubmitting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One key per intentional submission: a retry of the same click reuses it (an exact replay).
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId)

  if (!open) return null

  const latitude = Number(draft.latitude)
  const longitude = Number(draft.longitude)
  const expectedAt = sastInputToIso(draft.expectedAt)
  const complete = draft.incomingDriverId !== '' && draft.label.trim() !== '' && draft.reason.trim() !== ''
    && draft.latitude.trim() !== '' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && draft.longitude.trim() !== '' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && expectedAt !== null && (!replacing || draft.replacementReason.trim() !== '')

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
    // Changing the content makes it a different intentional action, with its own key.
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
    if (!complete || submitting || expectedAt === null) return
    setSubmitting(true)
    const fields = {
      client_request_id: clientRequestId, incoming_driver_id: draft.incomingDriverId,
      exchange: { label: draft.label.trim(), latitude, longitude, instructions: draft.instructions.trim() },
      expected_at: expectedAt, is_planned: draft.isPlanned, reason: draft.reason.trim(),
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
    <Modal open onClose={close} title={replacing ? 'Replace driver handover' : 'Arrange driver handover'} size="md" closeDisabled={submitting}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={submitting}>Cancel</Button>
        <Button onClick={submit} loading={submitting} disabled={!complete}>{replacing ? 'Replace handover' : 'Arrange handover'}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-on-surf-v">
          The trip keeps its original record. Custody moves only when both drivers confirm, or when you complete it with a recorded reason.
        </p>
        <Select label="Incoming driver" value={draft.incomingDriverId} onChange={e => set('incomingDriverId', e.target.value)}>
          <option value="">Choose a driver</option>
          {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}
        </Select>
        <Input label="Exchange point" value={draft.label} maxLength={255} onChange={e => set('label', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Latitude" inputMode="decimal" value={draft.latitude} onChange={e => set('latitude', e.target.value)} />
          <Input label="Longitude" inputMode="decimal" value={draft.longitude} onChange={e => set('longitude', e.target.value)} />
        </div>
        <TextArea label="Instructions for the drivers" value={draft.instructions} maxLength={1000} onChange={e => set('instructions', e.target.value)} />
        <Input label="Expected exchange time (SAST)" type="datetime-local" value={draft.expectedAt} onChange={e => set('expectedAt', e.target.value)} />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={draft.isPlanned} onChange={e => set('isPlanned', e.target.checked)} /> Planned handover
        </label>
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
