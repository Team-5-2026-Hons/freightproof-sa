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
import { InfoRow } from '@/components/ui/InfoRow'
import { Input } from '@/components/ui/Input'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import {
  cancelSubstitution, completeSubstitution, correctSubstitution, newClientRequestId, substitutionErrorCode,
} from '@/lib/api/driverSubstitutions'
import { sastInputToIso } from '@/lib/format/sast'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { DriverSubstitutionDialog } from './DriverSubstitutionDialog'

const LIVE_STATUSES = new Set(['active', 'exception_hold'])

const INTEGRITY_CHIP: Record<CustodyIntegrityStatus, { type: ChipType; label: string }> = {
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

function problemText(err: unknown, fallback: string): string {
  const code = substitutionErrorCode(err)
  return (code && CODE_TEXT[code]) || (err instanceof ApiError ? err.message : fallback)
}

interface Props {
  trip: Trip
  /** Refetch the trip after any change: the server's read, not a local guess, is shown next. */
  onChanged: () => void
}

/**
 * The trip's driver and handover controls (FP-83). Custody is derived server-side; this panel
 * only shows it and asks for changes. Every action is offered from the server's own
 * permitted_actions and the new-arrangement flag, and the server enforces each one again.
 */
export function DriverSubstitutionPanel({ trip, onChanged }: Props) {
  const { drivers } = useDrivers()
  const [dialog, setDialog] = useState<{ replacing: SubstitutionRequestRead | null } | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const pending = trip.pending_driver_substitution ?? null
  const history = (trip.driver_substitutions ?? []).filter(r => r.state !== 'pending')
  const enabled = trip.driver_substitutions_enabled === true
  const live = LIVE_STATUSES.has(trip.status)
  const changedDriver = trip.original_driver && trip.driver && trip.original_driver.id !== trip.driver.id
  const candidates = drivers.filter(d => d.id !== trip.driver?.id)

  function openDialog(replacing: SubstitutionRequestRead | null) {
    setDialogKey(k => k + 1)
    setDialog({ replacing })
  }

  return (
    <section aria-labelledby="driver-handover-heading" className="flex flex-col gap-3 border-t border-outline-v/30 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="driver-handover-heading" className="text-sm font-bold text-on-surf">Driver and handover</h3>
        {enabled && live && !pending && <Button size="sm" variant="secondary" onClick={() => openDialog(null)}>Arrange handover</Button>}
      </div>
      {!enabled && <p className="text-[12px] text-on-surf-v">New handovers are switched off. Existing handovers still work.</p>}

      <InfoRow label="Current driver" value={trip.driver?.full_name ?? '—'} />
      {changedDriver && <InfoRow label="Original driver" value={`${trip.original_driver?.full_name} (journey record, unchanged)`} />}
      {(trip.custody_sequence ?? 0) > 0 && <InfoRow label="Custody period" value={String(trip.custody_sequence)} />}
      {trip.custody_integrity && trip.custody_integrity.amendment_count > 0 && (
        <div className="flex flex-col gap-1">
          <div><Chip type={INTEGRITY_CHIP[trip.custody_integrity.status].type} label={INTEGRITY_CHIP[trip.custody_integrity.status].label} /></div>
          {trip.custody_integrity.pending_anchor_count > 0 && (
            <p className="text-[12px] text-on-surf-v">{trip.custody_integrity.pending_anchor_count} record(s) waiting to be anchored. Custody is not affected.</p>
          )}
          {trip.custody_integrity.findings.map(f => <p key={f} className="text-[12px] text-err">{f}</p>)}
        </div>
      )}

      {pending && (
        <PendingHandover tripId={trip.id} request={pending} onChanged={onChanged} onReplace={() => openDialog(pending)} canReplace={enabled} />
      )}

      {history.length > 0 && (
        <ul aria-label="Handover history" className="flex flex-col gap-2">
          {history.map(r => <HistoryItem key={r.id} tripId={trip.id} request={r} onChanged={onChanged} />)}
        </ul>
      )}

      {dialog && (
        <DriverSubstitutionDialog key={dialogKey} tripId={trip.id} open drivers={candidates} replacing={dialog.replacing}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged() }} />
      )}
    </section>
  )
}

function PendingHandover({ tripId, request, canReplace, onChanged, onReplace }: {
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
      <p className="mt-1">Planned exchange: {request.exchange.label}, {when(request.expected_at)}</p>
      <p className="text-[12px] text-on-surf-v">
        Planned point {request.exchange.latitude.toFixed(5)}, {request.exchange.longitude.toFixed(5)} (not the vehicle’s live position)
      </p>
      <p className="mt-1">
        Confirmed by: {request.confirmations.length ? request.confirmations.map(c => c.role).join(', ') : 'no one yet'}
        {missing && ` · waiting for ${request.missing_confirmations.join(' and ')}`}
      </p>
      {/* The recorded status, never relabelled: an attestation does not make PENDING verified. */}
      <p>Incoming driver identity: {request.identity.status}</p>
      {request.completion_blocked_by && <p role="status" className="mt-1 text-err">{BLOCKER_TEXT[request.completion_blocked_by]}</p>}

      {mode === 'idle' && (
        <div className="mt-2 flex flex-wrap gap-2">
          {can('complete_attested') && <Button size="sm" variant="secondary" onClick={() => start('complete')}>Complete handover</Button>}
          {can('replace') && canReplace && <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>}
          {can('cancel') && <Button size="sm" variant="danger" onClick={() => start('cancel')}>Cancel handover</Button>}
        </div>
      )}
      {mode === 'complete' && (
        <div className="mt-2 flex flex-col gap-2">
          {missing && <TextArea label="Why complete without both confirmations" value={missingReason} maxLength={1000} onChange={e => setMissingReason(e.target.value)} />}
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

function HistoryItem({ tripId, request, onChanged }: { tripId: string; request: SubstitutionRequestRead; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key, setKey] = useState(newClientRequestId)
  const completed = request.state === 'completed'

  async function clarify() {
    if (!request.completed_substitution_id) return
    setBusy(true)
    try {
      await correctSubstitution(tripId, request.completed_substitution_id, { client_request_id: key, reason: reason.trim(), correction_note: note.trim() })
      setOpen(false)
      onChanged()
    } catch (err) {
      setProblem(problemText(err, 'Could not add the clarification.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-outline-v/30 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{request.outgoing.full_name} → {request.incoming.full_name}</span>
        <Chip type={completed ? 'transit' : 'pending'} label={completed ? 'Completed' : 'Cancelled'} />
      </div>
      {completed
        ? <p className="text-[12px] text-on-surf-v">
          Effective {when(request.effective_at)} · {request.completion_mode === 'dispatcher_attested' ? 'dispatcher attested' : 'both drivers confirmed'}
          {' · '}incoming identity {request.identity.status}
        </p>
        : <p className="text-[12px] text-on-surf-v">Cancelled{request.replacement_request_id ? ' and replaced' : ''}. Custody did not change.</p>}
      {completed && !open && (
        <Button size="sm" variant="ghost" onClick={() => { setKey(newClientRequestId()); setOpen(true) }}>Add clarification</Button>
      )}
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[12px] text-on-surf-v">A clarification is appended to the record. It cannot change the drivers, the time or who holds the trip.</p>
          <TextArea label="Reason" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />
          <TextArea label="Clarification" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!reason.trim() || !note.trim()} onClick={clarify}>Add clarification</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Back</Button>
          </div>
          {problem && <p role="alert" className="text-err">{problem}</p>}
        </div>
      )}
    </li>
  )
}
