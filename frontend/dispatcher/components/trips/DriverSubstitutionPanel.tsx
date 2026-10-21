'use client'

import { useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type {
  CustodyIntegrityStatus,
  SubstitutionCompletionBlocker,
  SubstitutionErrorCode,
  SubstitutionRequestRead,
} from '@shared/lib/types/driver-substitution'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipType } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { Input } from '@/components/ui/Input'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import {
  cancelSubstitution, completeSubstitution, newClientRequestId, substitutionErrorCode,
} from '@/lib/api/driverSubstitutions'
import { fmtCompletionMode } from '@/lib/format/driver-transfer'
import { sastInputToIso } from '@/lib/format/sast'


export const INTEGRITY_CHIP: Record<CustodyIntegrityStatus, { type: ChipType; label: string }> = {
  verified: { type: 'transit', label: 'Chain verified' },
  pending: { type: 'pending', label: 'Anchoring pending' },
  failed: { type: 'exception', label: 'Integrity problem' },
}

const BLOCKER_TEXT: Record<SubstitutionCompletionBlocker, string> = {
  incoming_driver_inactive: 'The incoming driver’s account is not active.',
  licence_invalid: 'The incoming driver’s licence expiry is missing or has passed.',
  driver_unavailable: 'The incoming driver is committed to another trip.',
  identity_not_verified: 'The incoming driver’s identity is not verified. An admin can attest unavailable verification.',
}

const CODE_TEXT: Partial<Record<SubstitutionErrorCode, string>> = {
  IDENTITY_NOT_VERIFIED: 'Identity is not verified. An admin must attest unavailable verification, with a reason.',
  IDENTITY_ATTESTATION_FORBIDDEN: 'Only an admin dispatcher can attest unavailable identity. Nothing was recorded.',
  SUBSTITUTION_VERSION_CHANGED: 'Someone else changed this handover. It has been refreshed.',
  SUBSTITUTION_NOT_PENDING: 'This handover is no longer pending.',
}

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export function problemText(err: unknown, fallback: string): string {
  const code = substitutionErrorCode(err)
  return (code && CODE_TEXT[code]) || (err instanceof ApiError ? err.message : fallback)
}

interface Props {
  trip: Trip
  /** Opens the transfer evidence for a completed handover. The modal lives with the page, not here:
   *  below the dock width this panel renders inside DetailPanel's own overlay <dialog>. */
  onOpenTransfer: (substitutionId: string) => void
}

/**
 * The trip's custody at a glance (FP-83): what is waiting on a decision, each handover that
 * happened, and whether the record behind them holds. It only summarises: arranging, completing and
 * cancelling a handover live in the header's Transfer driver dialog, and a completed handover's
 * evidence (and its clarifications) in the evidence modal each row opens. Who drives now is not
 * repeated here: the header and this section's summary already say. Custody is derived server-side.
 */
export function DriverSubstitutionPanel({ trip, onOpenTransfer }: Props) {
  const pending = trip.pending_driver_substitution ?? null
  // One list in time order. Cancelled requests changed nothing, but stay in it: they are part of the
  // audit history. A request has no terminal timestamp of its own, so a cancelled one falls back to
  // when it was raised.
  const requests = (trip.driver_substitutions ?? []).filter(r => r.state !== 'pending')
    .sort((a, b) => Date.parse(a.effective_at ?? a.created_at) - Date.parse(b.effective_at ?? b.created_at))
  const enabled = trip.driver_substitutions_enabled === true
  const integrity = trip.custody_integrity && trip.custody_integrity.amendment_count > 0 ? trip.custody_integrity : null

  return (
    <div className="flex flex-col gap-3">
      {!enabled && <p className="text-[12px] text-on-surf-v">New handovers are switched off. Existing handovers still work.</p>}

      {pending && (
        <p className="rounded-lg bg-warn-c/40 px-3 py-2 text-[13px] text-on-surf">
          <span className="font-semibold">Transfer pending:</span> {pending.outgoing.full_name} → {pending.incoming.full_name}. Open View transfer in the trip header to resolve it.
        </p>
      )}

      {requests.length === 0 && !pending && <p className="text-[13px] text-on-surf-v">No driver changes on this trip.</p>}

      {requests.length > 0 && (
        <ul aria-label="Handover history" className="flex flex-col gap-2">
          {requests.map(r => <HistoryItem key={r.id} request={r} onOpenTransfer={onOpenTransfer} />)}
        </ul>
      )}

      {integrity && (integrity.status === 'verified'
        ? <p className="flex items-center gap-1.5 text-xs text-on-surf-v"><Ic n="check" s={13} className="text-ok" />Custody record verified</p>
        : <div className="flex flex-col gap-1">
          <div><Chip type={INTEGRITY_CHIP[integrity.status].type} label={INTEGRITY_CHIP[integrity.status].label} /></div>
          {integrity.pending_anchor_count > 0 && (
            <p className="text-[12px] text-on-surf-v">{integrity.pending_anchor_count} record(s) waiting to be anchored. Custody is not affected.</p>
          )}
          {integrity.findings.map(f => <p key={f} className="text-[12px] text-err">{f}</p>)}
        </div>)}
    </div>
  )
}

export function PendingHandover({ tripId, request, canReplace, onChanged, onReplace }: {
  tripId: string; request: SubstitutionRequestRead; canReplace: boolean; onChanged: () => void; onReplace: () => void
}) {
  const [mode, setMode] = useState<'idle' | 'complete' | 'cancel'>('idle')
  const [missingReason, setMissingReason] = useState('')
  const [identityReason, setIdentityReason] = useState('')
  const [declaredAt, setDeclaredAt] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One key per intentional action; a fresh one when the dispatcher opens the form again.
  const [key, setKey] = useState(newClientRequestId)
  const incomingOnly = request.request_format === 'immediate_v2'
  const missing = request.missing_confirmations.length > 0
  const mayAttestIdentity = request.permitted_actions.includes('attest_identity')
  const can = (action: SubstitutionRequestRead['permitted_actions'][number]) => request.permitted_actions.includes(action)

  function start(next: 'complete' | 'cancel') {
    setKey(newClientRequestId())
    setProblem(null)
    setMode(next)
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    try {
      await action()
      setMode('idle')
      onChanged()
    } catch (err) {
      setProblem(problemText(err, fallback))
      if (substitutionErrorCode(err) === 'SUBSTITUTION_VERSION_CHANGED') onChanged()
    } finally {
      setBusy(false)
    }
  }

  const complete = () => run(() => completeSubstitution(tripId, request.id, {
    client_request_id: key, expected_version: request.version,
    missing_confirmation_reason: missing ? missingReason.trim() : null,
    identity_unavailable_reason: identityReason.trim() || null,
    declared_exchange_at: sastInputToIso(declaredAt),
  }), 'Could not complete the handover.')
  const cancel = () => run(() => cancelSubstitution(tripId, request.id, {
    client_request_id: key, expected_version: request.version, reason: cancelReason.trim(),
  }), 'Could not cancel the handover.')

  return (
    <div className="rounded-lg border border-outline-v/40 bg-surf-lowest p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{request.outgoing.full_name} → {request.incoming.full_name}</span>
        <Chip type="pending" label="Pending" />
      </div>
      {request.exchange && <p className="mt-1">Planned exchange: {request.exchange.label}, {when(request.expected_at)}</p>}
      {request.exchange && <p className="text-[12px] text-on-surf-v">
        Planned point {request.exchange.latitude.toFixed(5)}, {request.exchange.longitude.toFixed(5)} (not the vehicle’s live position)
      </p>}
      {incomingOnly && <p>Outgoing driver: Not requested — notification only. Incoming driver acceptance is required.</p>}
      <p className="mt-1">
        Confirmed by: {request.confirmations.length ? request.confirmations.map(c => c.role).join(', ') : 'no one yet'}
        {missing && ` · waiting for ${request.missing_confirmations.join(' and ')}`}
      </p>
      {/* The recorded status, never relabelled: an attestation does not make PENDING verified. */}
      <p>Incoming driver identity: {request.identity.status}</p>
      {request.completion_blocked_by && <p role="status" className="mt-1 text-err">{BLOCKER_TEXT[request.completion_blocked_by]}</p>}

      {mode === 'idle' && (
        <div className="mt-2 flex flex-wrap gap-2">
          {can('complete_attested') && !(incomingOnly && missing) && <Button size="sm" variant="secondary" onClick={() => start('complete')}>Complete handover</Button>}
          {can('replace') && canReplace && <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>}
          {can('cancel') && <Button size="sm" variant="danger" onClick={() => start('cancel')}>Cancel handover</Button>}
        </div>
      )}
      {mode === 'complete' && (
        <div className="mt-2 flex flex-col gap-2">
          {missing && !incomingOnly && <TextArea label="Why complete without both confirmations" value={missingReason} maxLength={1000} onChange={e => setMissingReason(e.target.value)} />}
          {mayAttestIdentity && (
            <TextArea label="Attest unavailable identity verification (admin; leave empty to not attest)" value={identityReason}
              maxLength={1000} onChange={e => setIdentityReason(e.target.value)} />
          )}
          <Input label="Physical exchange time, if earlier (SAST)" type="datetime-local" value={declaredAt} onChange={e => setDeclaredAt(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={missing && !missingReason.trim()} onClick={complete}>Complete</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('idle')}>Back</Button>
          </div>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="mt-2 flex flex-col gap-2">
          <TextArea label="Why cancel" value={cancelReason} maxLength={1000} onChange={e => setCancelReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy} disabled={!cancelReason.trim()} onClick={cancel}>Cancel handover</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('idle')}>Back</Button>
          </div>
        </div>
      )}
      {problem && <p role="alert" className="mt-2 text-err">{problem}</p>}
    </div>
  )
}

function HistoryItem({ request, onOpenTransfer }: { request: SubstitutionRequestRead; onOpenTransfer: (substitutionId: string) => void }) {
  const names = `${request.outgoing.full_name} → ${request.incoming.full_name}`
  const completedId = request.state === 'completed' ? request.completed_substitution_id : null
  if (!completedId) {
    return <li className="px-1 text-xs text-on-surf-v">
      {names} · cancelled{request.replacement_request_id ? ' and replaced' : ''}. Custody did not change.
    </li>
  }
  // The one thing to act on in a row is a handover whose incoming identity is not confirmed.
  const identityNotVerified = request.identity.status !== 'verified'
  return <li>
    <button type="button" onClick={() => onOpenTransfer(completedId)} aria-haspopup="dialog" aria-label={`View evidence for the transfer from ${request.outgoing.full_name} to ${request.incoming.full_name}`}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-outline-v/40 bg-surf-lowest p-3 text-left hover:bg-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-on-surf">{names}</span>
        <span className="mt-0.5 block text-xs text-on-surf-v">{when(request.effective_at)} · {fmtCompletionMode(request.completion_mode, request.request_format)}</span>
        {identityNotVerified && <span className="mt-1.5 block"><Chip type="exception" label="Identity not verified" /></span>}
      </span>
      <span aria-hidden className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold text-sec">View evidence<Ic n="chev" s={12} /></span>
    </button>
  </li>
}
