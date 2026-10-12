'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipType } from '@/components/ui/Chip'
import { useToast } from '@/lib/hooks/useToast'
import { useAuditPacks } from '@/lib/hooks/useAuditPacks'
import { ApiError } from '@/lib/api/client'
import {
  downloadIssuedPdf,
  incidentSheetPdf,
  listAuditPackAccessEvents,
  listIncidentDeclarations,
  previewAuditPdf,
  revokeAuditPack,
  saveBlob,
} from '@/lib/api/auditPacks'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import {
  AUDIT_PACK_PURPOSES,
  type AuditPack,
  type AuditPackAccessEvent,
  type AuditPackStatus,
  type IncidentDeclaration,
} from '@/lib/types/auditPack'

const STATUS_CHIP: Record<AuditPackStatus, { type: ChipType; label: string }> = {
  active: { type: 'transit', label: 'Active' },
  expired: { type: 'pending', label: 'Expired' },
  revoked: { type: 'exception', label: 'Revoked' },
}

const EVENT_LABEL: Record<string, string> = {
  viewed: 'Opened', pdf_downloaded: 'Downloaded PDF', photo_viewed: 'Viewed a photo', verify_run: 'Ran live check',
  denied_expired: 'Tried an expired link', denied_revoked: 'Tried a revoked link',
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
  onDeclare: () => void
}

/** The caller re-keys this panel after an issue so it remounts and refetches the list. */
export function AuditPacksPanel({ tripId, tripReference, onIssue, onDeclare }: Props) {
  const { notify } = useToast()
  const { data: packs, isLoading, error, refetchSilent } = useAuditPacks(tripId)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<{ packId: string; events: AuditPackAccessEvent[] } | null>(null)
  const fetchDeclarations = useCallback(() => listIncidentDeclarations(tripId), [tripId])
  const declarations = useAsyncData<IncidentDeclaration[]>(fetchDeclarations, [])

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

  const sheet = () => run('sheet', async () => saveBlob(await incidentSheetPdf(tripId), `${tripReference}-incident-sheet.pdf`), 'Could not build the fact sheet.')
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
      <p className="text-[13px] leading-relaxed text-on-surf-v">
        An audit pack is a sealed, shareable record of this trip for an insurer, loss adjuster, client or SAPS. Each fact is
        labelled Anchored, Corroborated, Recorded or Declared so nothing claims more than the evidence supports.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onIssue}>Issue audit pack</Button>
        <Button size="sm" variant="secondary" loading={busy === 'preview'} onClick={preview}>Preview PDF</Button>
      </div>

      <section aria-label="Police and notifications" className="rounded-lg bg-surf-low p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-extrabold">Police &amp; notifications</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onDeclare}>Record police details</Button>
            <Button size="sm" variant="ghost" loading={busy === 'sheet'} onClick={sheet}>Incident fact sheet</Button>
          </div>
        </div>
        {declarations.data.length === 0 && !declarations.isLoading && (
          <p className="mt-1 text-[12px] text-on-surf-v">Nothing declared yet. Insurers will ask for the SAPS station and case number.</p>
        )}
        <ul className="mt-2 flex flex-col gap-1 text-[12px]">
          {declarations.data.map(d => (
            <li key={d.declaration_id}>
              {d.saps_cas_number ? <span className="font-semibold">CAS {d.saps_cas_number}</span> : <span className="font-semibold">Notification times</span>}
              {d.saps_station && ` · ${d.saps_station}`}
              <span className="text-on-surf-v"> · declared {when(d.declared_at)}{d.declared_by_name ? ` by ${d.declared_by_name}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      {isLoading && <p className="text-[13px] text-on-surf-v">Loading audit packs…</p>}
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
              <p className="mt-0.5 text-[12px] text-on-surf-v">
                {pack.anchor_status === 'anchored' ? `Sealed on Hedera · ${pack.hedera_tx_id ?? ''}` : 'Not sealed on Hedera'} ·{' '}
                {pack.view_count === 0 ? 'not opened yet' : `opened ${pack.view_count}× · last ${when(pack.last_viewed_at)}`}
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
