'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LateEvidenceDetailRead } from '@shared/lib/types/driver-substitution'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { TextArea } from '@/components/ui/TextArea'
import { ApiError } from '@/lib/api/client'
import { acknowledgeLateEvidence, listLateEvidence, newClientRequestId, substitutionErrorCode } from '@/lib/api/driverSubstitutions'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { LateEvidenceDetail } from './LateEvidenceDetail'

const EMPTY: LateEvidenceDetailRead[] = []

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

interface Props {
  tripId: string
  /** Driver names by id, from the trip's participants; an unknown id shows as such. */
  driverNames: Record<string, string>
}

/**
 * Evidence a driver captured in an earlier custody period, retained for review (FP-83). It
 * never completed a phase and never changed who holds the trip; acknowledging it records the
 * review and nothing else. Its hash is a local commitment, not a Hedera receipt.
 */
export function LateDriverEvidencePanel({ tripId, driverNames }: Props) {
  const fetchLate = useCallback(() => listLateEvidence(tripId), [tripId])
  const { data: items, isLoading, error, refetch, refetchSilent } = useAsyncData<LateEvidenceDetailRead[]>(fetchLate, EMPTY)
  // Silent: a spinner refetch makes the panel return null, which would unmount an open review
  // note and lose what the dispatcher had typed.
  useLiveResource('trip', tripId, refetchSilent, { kinds: ['late_driver_evidence_changed'] })
  useEffect(() => {
    const onVisible = (): void => { if (document.visibilityState === 'visible') refetchSilent() }
    window.addEventListener('focus', refetchSilent)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refetchSilent)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetchSilent])

  if (isLoading || (items.length === 0 && !error)) return null
  return (
    <section aria-labelledby="late-evidence-heading" className="mt-4 flex flex-col gap-2 border-t border-outline-v/30 pt-4">
      <h4 id="late-evidence-heading" className="text-[13px] font-bold text-on-surf">Late driver evidence</h4>
      <p className="text-[12px] text-on-surf-v">
        Captured before a handover and received afterwards. Kept for review; it did not complete any phase.
      </p>
      {error && <p role="status" className="text-[13px] text-err">{error}</p>}
      <ul className="flex flex-col gap-2">
        {items.map(item => <LateItem key={item.id} tripId={tripId} item={item} driverName={driverNames[item.driver_id] ?? 'Unknown driver'} onChanged={refetch} />)}
      </ul>
    </section>
  )
}

function LateItem({ tripId, item, driverName, onChanged }: { tripId: string; item: LateEvidenceDetailRead; driverName: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key, setKey] = useState(newClientRequestId)
  const acknowledged = item.status === 'acknowledged'

  async function acknowledge() {
    setBusy(true)
    try {
      await acknowledgeLateEvidence(tripId, item.id, { client_request_id: key, note: note.trim() })
      setOpen(false)
      onChanged()
    } catch (err) {
      setProblem(substitutionErrorCode(err) === 'SUBSTITUTION_VERSION_CHANGED'
        ? 'Another dispatcher already reviewed this. It has been refreshed.'
        : err instanceof ApiError ? err.message : 'Could not record the review.')
      if (substitutionErrorCode(err) === 'SUBSTITUTION_VERSION_CHANGED') onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-outline-v/30 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{driverName} · {item.evidence.kind} · custody period {item.custody_sequence}</span>
        <Chip type={acknowledged ? 'transit' : 'pending'} label={acknowledged ? 'Reviewed' : 'Awaiting review'} />
      </div>
      <p className="text-[12px] text-on-surf-v">Captured {when(item.captured_at)} · received {when(item.received_at)} · {item.artifacts.length} photo(s)</p>
      <p className="truncate font-mono text-[11px] text-on-surf-v" title={item.payload_sha256}>{item.payload_sha256}</p>
      <LateEvidenceDetail item={item} onRetry={onChanged} />
      {acknowledged && item.review_note && <p className="mt-1">Review note: {item.review_note}</p>}
      {!acknowledged && !open && <Button size="sm" variant="secondary" onClick={() => { setKey(newClientRequestId()); setOpen(true) }}>Acknowledge</Button>}
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <TextArea label="Review note" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!note.trim()} onClick={acknowledge}>Record review</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Back</Button>
          </div>
        </div>
      )}
      {problem && <p role="alert" className="mt-1 text-err">{problem}</p>}
    </li>
  )
}
