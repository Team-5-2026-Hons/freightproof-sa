'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/lib/hooks/useToast'
import { ApiError } from '@/lib/api/client'
import { issueAuditPack } from '@/lib/api/auditPacks'
import {
  AUDIT_PACK_EXPIRY_OPTIONS,
  AUDIT_PACK_PURPOSES,
  type AuditPackCreate,
  type AuditPackExpiryDays,
  type AuditPackIssued,
  type AuditPackPurpose,
} from '@/lib/types/auditPack'
import type { ConsignmentRead } from '@shared/lib/types/trip'

interface Props {
  tripId: string
  consignments: ConsignmentRead[]
  open: boolean
  onClose: () => void
  onIssued: () => void
}

const EMPTY: AuditPackCreate = {
  recipient_name: '', recipient_organization: '', recipient_email: null, purpose: 'insurance_claim',
  external_reference: null, scope_consignment_id: null, include_location_trail: true,
  include_full_driver_id: false, expires_in_days: 30,
}

/**
 * Issues an audit pack: the backend snapshots the trip, renders and stores the PDF, seals
 * it on Hedera and returns the share link. The link is shown here ONCE — the server keeps
 * only its hash — so the success view makes copying it the one obvious next step.
 *
 * Rendered as a sibling of DetailPanel (like CancelTripDialog): a modal nested in the
 * panel's own overlay <dialog> would centre on that box instead of the viewport.
 */
export function IssueAuditPackDialog({ tripId, consignments, open, onClose, onIssued }: Props) {
  const { notify } = useToast()
  const [form, setForm] = useState<AuditPackCreate>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [issued, setIssued] = useState<AuditPackIssued | null>(null)
  const [copied, setCopied] = useState(false)

  if (!open) return null
  const ready = form.recipient_name.trim() !== '' && form.recipient_organization.trim() !== ''

  function update<K extends keyof AuditPackCreate>(key: K, value: AuditPackCreate[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function close() {
    if (submitting) return
    setForm(EMPTY)
    setIssued(null)
    setCopied(false)
    onClose()
  }

  async function submit() {
    if (!ready || submitting) return
    setSubmitting(true)
    try {
      const result = await issueAuditPack(tripId, {
        ...form,
        recipient_email: form.recipient_email?.trim() || null,
        external_reference: form.external_reference?.trim() || null,
      })
      setIssued(result)
      onIssued()
    } catch (err) {
      const title =
        err instanceof ApiError && err.status === 403 ? 'Only admin dispatchers can issue audit packs.'
        : err instanceof ApiError && err.status === 503 ? err.message
        : err instanceof ApiError && err.status === 422 ? 'Check the recipient details and try again.'
        : 'Could not issue the audit pack. Please try again.'
      notify({ kind: 'error', title })
    } finally {
      setSubmitting(false)
    }
  }

  async function copy() {
    if (!issued) return
    await navigator.clipboard.writeText(issued.share_url)
    setCopied(true)
  }

  if (issued) {
    return (
      <Modal open onClose={close} title={`Issued ${issued.pack.pack_label}`}>
        <p className="mb-3 text-[13px] leading-relaxed text-on-surf-v">
          Send this link to {issued.pack.recipient_name}. It is shown only now — FreightProof keeps just its fingerprint —
          and it expires on {new Date(issued.pack.expires_at).toLocaleDateString('en-ZA')}. You can revoke it at any time.
        </p>
        <div className="mb-3 break-all rounded-md bg-surf-low px-3 py-2 font-mono text-[12px]" data-testid="share-url">{issued.share_url}</div>
        <p className="mb-4 text-[12px] text-on-surf-v">
          {issued.pack.anchor_status === 'anchored'
            ? 'The pack is sealed on Hedera.'
            : 'The Hedera seal did not complete; the pack is issued but shows as unsealed.'}
        </p>
        <div className="flex flex-col gap-2">
          <Button full onClick={copy}>{copied ? 'Link copied' : 'Copy share link'}</Button>
          <Button variant="secondary" full onClick={close}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={close} closeDisabled={submitting} title="Issue audit pack">
      <p className="mb-4 text-[13px] leading-relaxed text-on-surf-v">
        Freezes this trip&apos;s evidence into a PDF sealed on Hedera, with a private link the recipient can open without
        an account. Every view of the link is logged.
      </p>
      <div className="flex flex-col gap-3">
        <Input label="Recipient name" value={form.recipient_name} onChange={e => update('recipient_name', e.target.value)} />
        <Input label="Recipient organisation" value={form.recipient_organization} onChange={e => update('recipient_organization', e.target.value)} />
        <Input label="Recipient email (optional)" type="email" value={form.recipient_email ?? ''} onChange={e => update('recipient_email', e.target.value)} />
        <Select label="Purpose" value={form.purpose} onChange={e => update('purpose', e.target.value as AuditPackPurpose)}>
          {AUDIT_PACK_PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        <Input label="Claim or case reference (optional)" value={form.external_reference ?? ''} onChange={e => update('external_reference', e.target.value)} />
        {consignments.length > 1 && (
          <Select label="Scope" value={form.scope_consignment_id ?? ''} onChange={e => update('scope_consignment_id', e.target.value || null)}>
            <option value="">Whole trip</option>
            {consignments.map(c => <option key={c.id} value={c.id}>Only consignment {c.parcel_perfect_reference}</option>)}
          </Select>
        )}
        <Select label="Link valid for" value={form.expires_in_days} onChange={e => update('expires_in_days', Number(e.target.value) as AuditPackExpiryDays)}>
          {AUDIT_PACK_EXPIRY_OPTIONS.map(days => <option key={days} value={days}>{days} days</option>)}
        </Select>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>Include the GPS location trail</span>
          <Switch checked={form.include_location_trail} onCheckedChange={v => update('include_location_trail', v)} ariaLabel="Include the GPS location trail" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>
            Include the driver&apos;s full ID number
            <span className="block text-[11px] text-on-surf-v">Only when an insurer&apos;s claim form requires it (POPIA).</span>
          </span>
          <Switch checked={form.include_full_driver_id} onCheckedChange={v => update('include_full_driver_id', v)} ariaLabel="Include the driver's full ID number" />
        </label>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button full loading={submitting} disabled={!ready || submitting} onClick={submit}>
          {submitting ? 'Sealing on Hedera…' : 'Issue pack'}
        </Button>
        <Button variant="secondary" full onClick={close} disabled={submitting}>Cancel</Button>
      </div>
    </Modal>
  )
}
