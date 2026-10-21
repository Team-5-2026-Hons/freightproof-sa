'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipType } from '@/components/ui/Chip'
import { useToast } from '@/lib/hooks/useToast'
import { useAuditPacks } from '@/lib/hooks/useAuditPacks'
import { ApiError } from '@/lib/api/client'
import {
  downloadIssuedPdf,
  listAuditPackAccessEvents,
  previewAuditPdf,
  revokeAuditPack,
  saveBlob,
} from '@/lib/api/auditPacks'
import { SectionRowsSkeleton } from '@/components/incidents/IncidentSkeletons'
import {
  AUDIT_PACK_PURPOSES,
  type AuditPack,
  type AuditPackAccessEvent,
  type AuditPackStatus,
} from '@/lib/types/auditPack'

const STATUS_CHIP: Record<AuditPackStatus, { type: ChipType; label: string }> = {
  active: { type: 'transit', label: 'Active' },
  expired: { type: 'pending', label: 'Expired' },
  revoked: { type: 'exception', label: 'Revoked' },
}

const EVENT_LABEL: Record<string, string> = {
  viewed: 'Opened', pdf_downloaded: 'Downloaded PDF', photo_viewed: 'Viewed a photo', verify_run: 'Ran live check',
  denied_expired: 'Tried an expired link', denied_revoked: 'Tried a revoked link',
  // FP-291 emailed code. Unverified opens are expected once (the recipient's first visit);
  // many, or wrong codes, are what a forwarded link looks like.
  code_sent: 'Code emailed', code_verified: 'Entered the emailed code',
  denied_bad_code: 'Entered a wrong or expired code', denied_unverified: 'Opened without the code',
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function purposeLabel(value: string): string {
  return AUDIT_PACK_PURPOSES.find(p => p.value === value)?.label ?? value
}

interface Props {
  tripId: string
  tripReference: string
  onIssue: () => void
  /** Called each time the list has finished loading, so the caller can drop any space it reserved for it. */
  onLoaded?: () => void
}

/** The body of the Info tab's Audit packs section, which supplies the heading. The caller re-keys
 *  this panel after an issue so it remounts and refetches the list. */
export function AuditPacksPanel({ tripId, tripReference, onIssue, onLoaded }: Props) {
  const { notify } = useToast()
  const { data: packs, isLoading, error, refetchSilent } = useAuditPacks(tripId)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    if (!isLoading) onLoaded?.()
    // Once per load: the caller's callback changing identity is not a reason to fire it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])
  const [log, setLog] = useState<{ packId: string; events: AuditPackAccessEvent[] } | null>(null)

  async function run(key: string, action: () => Promise<void>, failure: string) {
    setBusy(key)
    try {
      await action()
    } catch (err) {
      notify({ kind: 'error', title: err instanceof ApiError && err.status === 403 ? 'Admin dispatcher role required.' : err instanceof ApiError && err.status === 409 ? err.message : failure })
    } finally {
      setBusy(null)
    }
  }

  const preview = () => run('preview', async () => saveBlob(await previewAuditPdf(tripId), `${tripReference}-audit-preview.pdf`), 'Could not build the preview.')
  const download = (pack: AuditPack) => run(`pdf-${pack.id}`, async () => saveBlob(await downloadIssuedPdf(pack.id), `${pack.pack_label}.pdf`), 'Could not download the PDF.')
  const revoke = (pack: AuditPack) => run(`revoke-${pack.id}`, async () => {
    await revokeAuditPack(pack.id)
    notify({ kind: 'success', title: `${pack.pack_label} revoked` })
    refetchSilent()
  }, 'Could not revoke the pack.')
  const showLog = (pack: AuditPack) => run(`log-${pack.id}`, async () => {
    setLog({ packId: pack.id, events: await listAuditPackAccessEvents(pack.id) })
  }, 'Could not load the access log.')

  const forbidden = error?.includes('Admin dispatcher role required')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" loading={busy === 'preview'} onClick={preview}>Preview PDF</Button>
        <Button size="sm" variant="secondary" onClick={onIssue}>Issue audit pack</Button>
      </div>
      {isLoading && <SectionRowsSkeleton rows={2} label="Loading audit packs" />}
      {error && <p role="status" className="text-[13px] text-err">{forbidden ? 'Only admin dispatchers can see and issue audit packs.' : error}</p>}
      {!isLoading && !error && packs.length === 0 && <p className="text-[13px] text-on-surf-v">No audit packs issued for this trip yet.</p>}

      <ul className="flex flex-col gap-3">
        {packs.map(pack => {
          const chip = STATUS_CHIP[pack.status]
          return (
            <li key={pack.id} className="rounded-lg border border-outline-v/40 bg-surf-lowest p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-extrabold tabular-nums tracking-[0.03em]">{pack.pack_label}</span>
                <Chip type={chip.type} label={chip.label} />
              </div>
              <p className="mt-1 text-[13px]">
                {pack.recipient_name}, {pack.recipient_organization} · {purposeLabel(pack.purpose)}
                {pack.external_reference && ` · ref ${pack.external_reference}`}
              </p>
              <p className="mt-0.5 text-[12px] text-on-surf-v">
                Issued {when(pack.issued_at)} · {pack.revoked_at ? `revoked ${when(pack.revoked_at)}` : `expires ${when(pack.expires_at)}`}
              </p>
              <p className="mt-0.5 flex min-w-0 gap-1 text-[12px] text-on-surf-v">
                {pack.anchor_status === 'anchored'
                  ? <><span className="shrink-0">Sealed on Hedera ·</span><span className="truncate" title={pack.hedera_tx_id ?? undefined}>{pack.hedera_tx_id ?? ''}</span></>
                  : <span>Not sealed on Hedera</span>}
              </p>
              <p className="mt-0.5 text-[12px] text-on-surf-v">
                {pack.view_count === 0 ? 'Not opened yet' : `Opened ${pack.view_count}× · last ${when(pack.last_viewed_at)}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={busy === `pdf-${pack.id}`} onClick={() => download(pack)}>PDF</Button>
                <Button size="sm" variant="ghost" loading={busy === `log-${pack.id}`} onClick={() => showLog(pack)}>Access log</Button>
                {pack.status === 'active' && (
                  <Button size="sm" variant="danger" loading={busy === `revoke-${pack.id}`} onClick={() => revoke(pack)}>Revoke link</Button>
                )}
              </div>
              {log?.packId === pack.id && (
                <ul aria-label={`Access log for ${pack.pack_label}`} className="mt-2 flex flex-col gap-1 border-t border-outline-v/30 pt-2 text-[12px]">
                  {log.events.length === 0 && <li className="text-on-surf-v">No one has used this link yet.</li>}
                  {log.events.map(event => (
                    <li key={`${event.created_at}-${event.event_type}`}>
                      <span className={event.event_type.startsWith('denied') ? 'font-semibold text-err' : ''}>{EVENT_LABEL[event.event_type] ?? event.event_type}</span>
                      <span className="text-on-surf-v"> · {when(event.created_at)}{event.client_ip ? ` · ${event.client_ip}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
