'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip, type ChipType } from '@/components/ui/Chip'
import { InfoRow } from '@/components/ui/InfoRow'
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
  /** The caller's region is labelled by this heading, so the heading is rendered here, beside the actions. */
  headingId: string
  onIssue: () => void
  onDeclare: () => void
}

/** The caller re-keys this panel after an issue so it remounts and refetches the list. */
export function AuditPacksPanel({ tripId, tripReference, headingId, onIssue, onDeclare }: Props) {
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-bold text-on-surf">Audit packs</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" loading={busy === 'preview'} onClick={preview}>Preview PDF</Button>
          <Button size="sm" variant="secondary" onClick={onIssue}>Issue audit pack</Button>
        </div>
      </div>
      <div className="text-[13px] leading-relaxed text-on-surf-v">
        <p>A sealed, shareable record of this trip for an insurer, loss adjuster, client or SAPS.</p>
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold text-sec">How facts are labelled</summary>
          <p className="mt-2">Each fact is labelled Anchored, Corroborated, Recorded or Declared so nothing claims more than the evidence supports.</p>
        </details>
      </div>

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

      <section aria-label="Police and notifications" className="border-t border-outline-v/30 pt-4">
        <h3 className="mb-1 text-[13px] font-bold text-on-surf">Police &amp; notifications</h3>
        {declarations.data.length === 0 && !declarations.isLoading && (
          <>
            <InfoRow label="SAPS case no." value="Not recorded" />
            <p className="mt-1 text-[12px] text-on-surf-v">Insurers will ask for the SAPS station and case number.</p>
          </>
        )}
        {declarations.data.map(d => (
          <div key={d.declaration_id}>
            {d.saps_cas_number ? <InfoRow label="SAPS case no." value={`CAS ${d.saps_cas_number}`} mono /> : <InfoRow label="Notification times" value="Declared" />}
            {d.saps_station && <InfoRow label="SAPS station" value={d.saps_station} />}
            <p className="py-1 text-[11px] text-on-surf-v">Declared {when(d.declared_at)}{d.declared_by_name ? ` by ${d.declared_by_name}` : ''}</p>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onDeclare}>Record police details</Button>
          <Button size="sm" variant="ghost" loading={busy === 'sheet'} onClick={sheet}>Incident fact sheet</Button>
        </div>
      </section>
    </div>
  )
}
