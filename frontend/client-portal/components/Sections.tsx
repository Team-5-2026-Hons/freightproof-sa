'use client'

import { useMemo, useState } from 'react'
import { formatCoord, formatRand, formatSast, humanise, pluralise } from '@/lib/format'
import { mirrorMessageUrl, trustedMirrorBase } from '@/lib/verify'
import { notAnchoredReason } from '@/lib/anchors'
import { receiptLabel } from '@/lib/receipt-labels'
import { readSealPayload, sealedString, type SealPayloadRead } from '@/lib/seal'
import { exceptionLabel } from '@/lib/timeline'
import type { AuditPackManifest, ExceptionRecord, InvestigationEntryRecord, PublicPackSeal } from '@/lib/types'
import { Card, Field } from './Card'
import { DownloadButton } from './DownloadButton'
import { Eyebrow } from './Eyebrow'
import { TIER_ORDER, TierBadge, tierMeaning } from './TierBadge'

export function Observations({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Observations" id="observations" aside={<span className="text-caption text-muted">What the record shows — not findings of fault</span>}>
      <ul className="space-y-1.5">
        {manifest.observations.map((o, i) => (
          <li
            key={`${o.code}-${i}`}
            className={`rounded-md border-l-[3px] px-3 py-2 text-body ${o.level === 'attention' ? 'border-err bg-err-c/40' : 'border-outline-v bg-surf-low'}`}
          >
            {o.text}
          </li>
        ))}
        {manifest.observations.length === 0 && <li className="text-body text-muted">No observations.</li>}
      </ul>
    </Card>
  )
}

export function TierLegend() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {TIER_ORDER.map((tier) => (
        <li key={tier} className="flex items-start gap-2 text-meta">
          <TierBadge tier={tier} />
          <span className="text-muted">{tierMeaning(tier)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Incident({ token, manifest, onSelect }: { token: string; manifest: AuditPackManifest; onSelect: (id: string) => void }) {
  const incident = manifest.incident
  if (!incident) return null
  const declarations = manifest.declarations ?? []
  const declaredByOperator = incident.basis === 'investigation'
  return (
    <Card
      title="Incident summary"
      id="incident"
      aside={
        <DownloadButton
          token={token}
          file="incident-sheet.pdf"
          filename={`${manifest.trip.trip_reference}-incident-sheet.pdf`}
          className="min-h-11 text-meta font-semibold text-sec underline disabled:opacity-60"
        >
          Download incident fact sheet
        </DownloadButton>
      }
    >
      <dl>
        <Field label={declaredByOperator ? 'Reported hijacking (declared by the operator)' : 'First critical event'}>
          {incident.exception_ids.length > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center font-semibold text-sec underline"
              onClick={() => onSelect(incident.exception_ids[0])}
            >
              {humanise(incident.first_exception_type)}
            </button>
          ) : (
            <span className="font-semibold">{humanise(incident.first_exception_type)}</span>
          )}{' '}
          <span className="num">{formatSast(incident.first_raised_at)}</span>
        </Field>
        <Field label="Where it was raised"><span className="num">{formatCoord(incident.position)}</span></Field>
        <Field label="Last known position at or before it">
          <span className="num">{formatCoord(incident.last_known_position)}</span>
          {incident.last_known_position && (
            <span className="text-muted"> · {humanise(incident.last_known_position.source)} · {formatSast(incident.last_known_position.recorded_at)}</span>
          )}
        </Field>
        {(incident.first_reviewed_at || !declaredByOperator) && (
          <Field label="First dispatcher review">
            {incident.first_reviewed_at
              ? <span className="num">{formatSast(incident.first_reviewed_at)} ({incident.minutes_to_first_review} min after)</span>
              : <span className="font-semibold text-err">No review recorded</span>}
          </Field>
        )}
      </dl>
      <Eyebrow as="h4" className="mb-1 mt-4 flex items-center gap-2">
        Police report and notifications <TierBadge tier="declared" />
      </Eyebrow>
      {declarations.length === 0 && (
        <p className="text-meta text-muted">
          No police report or notification times have been declared by the operator. A claim will need the SAPS station and case number.
        </p>
      )}
      <ul className="space-y-2">
        {declarations.map((d) => (
          <li key={d.declaration_id} className="rounded-md border border-dashed border-warn/60 px-3 py-2 text-body">
            {(d.saps_station || d.saps_cas_number) && (
              <p>SAPS {d.saps_station ?? ''}{d.saps_cas_number && <span className="num font-semibold"> · CAS {d.saps_cas_number}</span>}{d.saps_officer && ` · ${d.saps_officer}`}</p>
            )}
            {d.reported_to_saps_at && <p className="num">Reported to SAPS {formatSast(d.reported_to_saps_at)}</p>}
            {d.tracking_company_notified_at && <p className="num">Tracking company told {formatSast(d.tracking_company_notified_at)}</p>}
            {d.client_notified_at && <p className="num">Client told {formatSast(d.client_notified_at)}</p>}
            {d.insurer_notified_at && <p className="num">Insurer told {formatSast(d.insurer_notified_at)}</p>}
            {d.insurer_claim_reference && <p>Claim ref <span className="num">{d.insurer_claim_reference}</span></p>}
            {d.note && <p className="text-muted">{d.note}</p>}
            <p className="mt-1 text-caption text-muted">Declared {formatSast(d.declared_at)}{d.declared_by_name && ` by ${d.declared_by_name}`}; not captured by FreightProof.</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function TripPlan({ manifest }: { manifest: AuditPackManifest }) {
  const { trip } = manifest
  return (
    <Card title="Trip and stops" id="trip-plan">
      <dl>
        <Field label="Operator">{trip.operator_name}</Field>
        <Field label="Client(s)">{trip.client_names.join(', ') || '—'}</Field>
        <Field label="Order number"><span className="num">{trip.order_number ?? '—'}</span></Field>
        <Field label="Created / closed"><span className="num">{formatSast(trip.created_at)} / {formatSast(trip.closed_at)}</span></Field>
        <Field label="Status">{humanise(trip.status)}</Field>
      </dl>
      <Eyebrow as="h4" className="mb-1 mt-4">Stops</Eyebrow>
      <ol className="space-y-1.5 text-body">
        {manifest.stops.map((s) => (
          <li key={s.trip_stop_id}>
            <span className="num font-semibold">{s.sequence}.</span> {s.precinct_name}
            {s.address && <span className="text-muted"> · {s.address}</span>}
            {s.slot_time && <span className="num text-muted"> · slot {formatSast(s.slot_time)}</span>}
          </li>
        ))}
        {manifest.stops.length === 0 && <li className="text-muted">No stops recorded.</li>}
      </ol>
    </Card>
  )
}

export function Vehicles({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Vehicles" id="vehicles">
      <dl>
        {manifest.vehicles.map((v) => (
          <Field key={v.vehicle_id} label={humanise(v.role)}>
            <span className="num font-semibold">{v.registration}</span>
            {(v.make || v.model) && <span> · {[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>}
            <span className="block text-meta text-muted">
              Tracker {v.tracker_device_id} · licence disc {v.licence_disc_expiry ?? 'not recorded'}
              {v.licence_disc_valid_on_trip_date === false && <span className="font-semibold text-err"> (expired on trip date)</span>}
            </span>
          </Field>
        ))}
      </dl>
      {manifest.vehicles.length === 0 && <p className="text-body text-muted">No vehicles recorded.</p>}
      {manifest.record_changes.length > 0 && (
        <>
          <Eyebrow as="h4" className="mb-1 mt-4">Record changes during the trip</Eyebrow>
          <ul className="space-y-1 text-body">
            {manifest.record_changes.map((c, i) => (
              <li key={`${c.subject_id}-${c.changed_at}-${i}`}>
                {humanise(c.subject)} · {c.changed_fields.join(', ') || humanise(c.event_type)} · <span className="num">{formatSast(c.changed_at)}</span> <TierBadge tier={c.tier} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

export function Driver({ manifest }: { manifest: AuditPackManifest }) {
  const { driver } = manifest
  return (
    <Card title="Driver" id="driver">
      <dl>
        <Field label="Name">{driver.full_name}</Field>
        <Field label="Identity number"><span className="num">{driver.id_number}</span>{driver.id_number_masked && <span className="text-muted"> (masked)</span>}</Field>
        <Field label="Licence">
          <span className="num">{driver.license_number}</span> · expires {driver.license_expiry ?? 'not recorded'}
          {driver.license_valid_on_trip_date === false && <span className="font-semibold text-err"> (expired on trip date)</span>}
        </Field>
        <Field label="PrDP">Not recorded by FreightProof</Field>
        <Field label="Identity check for this trip">{humanise(driver.trip_idvs_status)}</Field>
        {driver.substitutions.map((s) => (
          <Field key={s.substitution_id} label="Driver substitution">
            {s.original_driver_name} → {s.substituting_driver_name}{s.exchange_location ? ` at ${s.exchange_location}` : ''}, {formatSast(s.substitution_at)} <TierBadge tier={s.tier} />
          </Field>
        ))}
      </dl>
    </Card>
  )
}

export function Cargo({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Cargo and consignments" id="cargo">
      {manifest.consignments.length === 0 && <p className="text-body text-muted">No consignments are linked to this trip.</p>}
      <div className="space-y-4">
        {manifest.consignments.map((c) => (
          <div key={c.consignment_id}>
            <h4 className="text-body font-extrabold">
              <span className="num">{c.parcel_perfect_reference}</span>{c.client_name && <span className="font-semibold text-muted"> · {c.client_name}</span>}
            </h4>
            <dl>
              <Field label="Declared value"><span className="num">{formatRand(c.declared_value)}</span></Field>
              <Field label="Parcels expected"><span className="num">{c.parcel_count_expected ?? '—'}</span></Field>
            </dl>
            {c.parcels.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-meta">
                  <thead className="text-micro uppercase tracking-eyebrow text-muted">
                    <tr><th className="py-1">Barcode</th><th>Status</th><th>Scanned out</th><th>Scanned in</th></tr>
                  </thead>
                  <tbody>
                    {c.parcels.map((p) => (
                      <tr key={p.barcode} className="border-t border-outline-v/40">
                        <td className="num py-1">{p.barcode}</td><td>{humanise(p.status)}</td>
                        <td className="num">{formatSast(p.pp_scan_out_at)}</td><td className="num">{formatSast(p.pp_scan_in_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function Exceptions({ exceptions, onSelect }: { exceptions: ExceptionRecord[]; onSelect: (id: string) => void }) {
  return (
    <Card title="Exceptions and response log" id="exceptions">
      {exceptions.length === 0 && <p className="text-body text-muted">No exceptions recorded.</p>}
      <ul className="space-y-2">
        {exceptions.map((e, i) => (
          <li key={e.exception_id} className="rounded-md bg-surf-low px-3 py-2 text-body">
            <button type="button" onClick={() => onSelect(e.exception_id)} className="min-h-11 text-left font-semibold text-sec underline">
              {exceptionLabel(i, e)}
            </button>
            <span className={`ml-2 text-caption font-bold uppercase ${e.severity === 'critical' ? 'text-err' : 'text-muted'}`}>{e.severity}</span>
            <span className="ml-2 align-middle"><TierBadge tier={e.tier} /></span>
            <span className="num block text-meta text-muted">{formatSast(e.raised_at)} · {humanise(e.source)}</span>
            <span className="block">{e.description}</span>
            <span className="block text-meta text-muted">
              Review: {humanise(e.review_status)}
              {e.reviewed_at && `, ${formatSast(e.reviewed_at)}`}{e.reviewer_name && ` by ${e.reviewer_name}`}
              {e.contact_method && ` via ${e.contact_method}`}{e.review_note && ` — “${e.review_note}”`}
            </span>
            {(e.anchors ?? []).length > 0 && (
              <span className="block text-meta text-muted">
                {(e.anchors ?? []).map((a) => {
                  const reason = notAnchoredReason(a)
                  return `${humanise(a.action)} — ${reason === null ? 'Anchored' : `Recorded, ${reason}`}`
                }).join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function Coverage({ manifest }: { manifest: AuditPackManifest }) {
  const coverage = manifest.location_coverage
  return (
    <Card title="Location coverage" id="coverage">
      <dl>
        <Field label="Window assessed"><span className="num">{formatSast(coverage.window_start)} → {formatSast(coverage.window_end)}</span></Field>
        <Field label="Fixes by source">
          {Object.entries(coverage.fix_counts).map(([source, count]) => `${humanise(source)}: ${count}`).join(' · ') || 'none'}
        </Field>
        <Field label="Gaps"><span className="num">{coverage.gaps.length}</span></Field>
      </dl>
      {coverage.gaps.length > 0 && (
        <ul className="mt-2 space-y-1 text-meta">
          {coverage.gaps.map((g) => (
            <li key={g.start} className="num">{formatSast(g.start)} → {formatSast(g.end)} · {g.minutes} min</li>
          ))}
        </ul>
      )}
      {coverage.stationary_periods.length > 0 && (
        <>
          <Eyebrow as="h4" className="mb-1 mt-3">Stationary outside route precincts</Eyebrow>
          <ul className="space-y-1 text-meta">
            {coverage.stationary_periods.map((s) => (
              <li key={s.start} className="num">{formatSast(s.start)} → {formatSast(s.end)} · {s.minutes} min · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 rounded-md border-l-[3px] border-warn-c bg-warn-soft px-3 py-2 text-meta">
        Phone positions are recorded only while the driver app is in use; the vehicle tracker is queried at each trip phase and
        at checkpoints. The absence of a position is not evidence that the vehicle was stationary.
      </p>
    </Card>
  )
}

function ConsistencyRow({ label, read, field, viewValue }: { label: string; read: SealPayloadRead; field: 'manifest_sha256' | 'pdf_sha256'; viewValue: string }) {
  const sealed = sealedString(read, field)
  const outcome = read.state !== 'ok'
    ? { text: 'cannot be compared', tone: 'text-warn' }
    : sealed === null
      ? { text: 'missing from the seal payload', tone: 'font-semibold text-err' }
      : sealed.toLowerCase() === viewValue.toLowerCase()
        ? { text: 'matches', tone: 'font-semibold text-ok' }
        : { text: 'DIFFERS', tone: 'font-semibold text-err' }
  return (
    <Field label={label}>
      <span className={outcome.tone}>{outcome.text}</span>
    </Field>
  )
}

function SealSummary({ seal, read }: { seal: PublicPackSeal; read: SealPayloadRead }) {
  if (!seal.seal) {
    return <p className="text-body text-warn">This pack was not sealed on Hedera (status: {humanise(seal.anchor_status)}).</p>
  }
  return (
    <>
      <dl>
        <Field label="Manifest fingerprint"><span className="num break-all">{seal.manifest_sha256}</span></Field>
        <Field label="PDF fingerprint"><span className="num break-all">{seal.pdf_sha256}</span></Field>
        <Field label="Hedera topic"><span className="num">{seal.seal.hedera_topic_id ?? '—'}</span></Field>
        <Field label="Sequence number"><span className="num">{seal.seal.hedera_sequence_number ?? '—'}</span></Field>
        <Field label="Transaction"><span className="num break-all">{seal.seal.hedera_tx_id ?? '—'}</span></Field>
        <ConsistencyRow label="Seal payload: manifest fingerprint" read={read} field="manifest_sha256" viewValue={seal.manifest_sha256} />
        <ConsistencyRow label="Seal payload: PDF fingerprint" read={read} field="pdf_sha256" viewValue={seal.pdf_sha256} />
      </dl>
      {read.state === 'unreadable' && <p className="text-meta text-warn">The seal payload could not be read as JSON.</p>}
      <p className="mt-1 text-meta text-muted">
        These compare fingerprints only. The manifest&apos;s own canonical text is not published with the pack, so it cannot be re-hashed here.
      </p>
    </>
  )
}

export function Integrity({ manifest, seal }: { manifest: AuditPackManifest; seal: PublicPackSeal }) {
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean } | null>(null)
  const sealRead = useMemo(() => readSealPayload(seal), [seal])
  const mirror = trustedMirrorBase(seal.hedera_network, seal.mirror_base_url)
  async function copy(id: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState({ id, copied: true })
    } catch (error) {
      console.warn('Could not copy to the clipboard', error)
      setCopyState({ id, copied: false })
    }
  }
  return (
    <Card title="Has anything been changed?" id="integrity">
      <p className="text-body">
        When each of these records was made, its fingerprint was published on Hedera, a public ledger FreightProof cannot
        alter. A record that still matches its fingerprint has not been changed since.
      </p>
      <ul className="mt-3 divide-y divide-outline-v/40 rounded-md border border-outline-v/50">
        {manifest.anchored_records.map((r) => (
          <li key={r.receipt_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5 text-body">
            <span className="font-semibold">{receiptLabel(r.receipt_type, r.subject_type)}</span>
            <span className={`text-small ${r.payload_matches_hash ? 'text-ok' : 'font-semibold text-err'}`}>
              {r.payload_matches_hash ? 'Unchanged' : 'Changed after it was published'}
              <span className="num font-normal text-muted">
                {r.hedera_consensus_at ? ` · published ${formatSast(r.hedera_consensus_at)}` : ' · not yet on the ledger'}
              </span>
            </span>
          </li>
        ))}
        {manifest.anchored_records.length === 0 && <li className="px-3 py-2.5 text-body text-muted">No records from this trip were published to the ledger.</li>}
      </ul>
      <p className="mt-2 text-meta text-muted">
        Checked when this pack was issued; the check at the top of this page repeats it live. An unchanged record shows
        it was not altered afterwards. It does not prove the events happened as described, or who is at fault.
      </p>

      <details className="group mt-4 border-t border-outline-v/50 pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body font-semibold text-sec">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          Technical detail for independent verification
        </summary>
        <p className="mt-2 text-small text-muted">
          Integrity appendix. To check a record without this page: SHA-256 the canonical payload exactly as shown (UTF-8),
          compare it with the data hash, then read the Hedera mirror-node address, base64-decode its <code>message</code>,
          and compare again.
        </p>
        <Eyebrow as="h4" className="mb-1 mt-3">Pack seal</Eyebrow>
        <SealSummary seal={seal} read={sealRead} />
        <Eyebrow as="h4" className="mb-1 mt-4">Anchored records</Eyebrow>
        <ul className="space-y-3">
          {manifest.anchored_records.map((r) => (
            <li key={r.receipt_id} className="rounded-md bg-surf-low p-3 text-meta">
              <p className="font-semibold">{receiptLabel(r.receipt_type, r.subject_type)} <span className="font-normal text-muted">({humanise(r.receipt_type)} · {humanise(r.subject_type)})</span></p>
              <p className="num break-all">Data hash {r.data_hash}</p>
              <p className="num break-all">
                Topic {r.hedera_topic_id ?? '—'} · sequence {r.hedera_sequence_number ?? '—'}
                {r.hedera_tx_id && ` · transaction ${r.hedera_tx_id}`}
              </p>
              {mirror && r.hedera_topic_id && r.hedera_sequence_number != null && (
                <a
                  className="num break-all text-sec underline"
                  href={mirrorMessageUrl(mirror, r.hedera_topic_id, r.hedera_sequence_number)}
                  target="_blank" rel="noreferrer noopener"
                >
                  {mirrorMessageUrl(mirror, r.hedera_topic_id, r.hedera_sequence_number)}
                </a>
              )}
              <pre className="num mt-2 whitespace-pre-wrap break-all rounded-sm bg-surf-lowest p-2 text-caption">{r.canonical_payload}</pre>
              <button type="button" onClick={() => void copy(r.receipt_id, r.canonical_payload)} className="no-print mt-1 min-h-11 text-meta font-semibold text-sec">
                {copyState?.id !== r.receipt_id ? 'Copy payload' : copyState.copied ? 'Copied' : 'Could not copy'}
              </button>
              {copyState?.id === r.receipt_id && !copyState.copied && (
                <span role="status" className="ml-2 text-meta text-warn">Select the payload above and copy it by hand.</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  )
}

/** Counts only: this viewer cannot render late evidence yet, and silence would read as "none". */
export function NotShownHere({ manifest }: { manifest: AuditPackManifest }) {
  const lateEvidence = manifest.late_evidence?.length ?? 0
  if (lateEvidence === 0) return null
  return (
    <Card title="Not shown in this viewer" id="not-shown">
      <p className="text-body">
        This pack also contains {pluralise(lateEvidence, 'late-evidence item')} that this web view does not display yet. They are included in the PDF.
      </p>
    </Card>
  )
}

function investigationEntryText(e: InvestigationEntryRecord): string {
  let text = humanise(e.kind)
  if (e.external_action) text += `: ${humanise(e.external_action)}${e.action_at ? ` at ${formatSast(e.action_at)}` : ''}`
  if (e.to_value && e.kind !== 'assigned' && e.kind !== 'opened') text += ` → ${humanise(e.to_value)}`
  if (e.note) text += ` · “${e.note}”`
  return text
}

/** The operator's investigation of each incident — the same record as the PDF's section 3.2. */
export function Investigations({ manifest }: { manifest: AuditPackManifest }) {
  const investigations = manifest.investigations ?? []
  if (investigations.length === 0) return null
  return (
    <Card title="Investigations" id="investigations" aside={<TierBadge tier="declared" />}>
      <div className="space-y-6">
        {investigations.map((i) => {
          const unresolved = i.parcels.filter((p) => p.latest_finding === null).length
          return (
            <article key={i.incident_id} aria-labelledby={`inv-${i.incident_id}`}>
              <h4 id={`inv-${i.incident_id}`} className="text-lead font-bold">
                <span className="num">{i.reference}</span> · {humanise(i.incident_type)}
                <span className="font-normal text-muted"> · {humanise(i.confidence)}</span>
              </h4>
              <p className="mt-1 text-body">{i.summary}</p>
              <dl className="mt-2">
                <Field label="Status">
                  {i.status === 'closed'
                    ? <>Closed <span className="num">{formatSast(i.closed_at)}</span> as <strong>{humanise(i.outcome)}</strong>{i.closure_reason && `: ${i.closure_reason}`}</>
                    : <><strong>{humanise(i.status)}</strong> — not concluded when this pack was generated</>}
                </Field>
                <Field label="Reported by">{humanise(i.reporter_role)} via {humanise(i.report_channel)}</Field>
                <Field label="Reportedly happened">
                  {i.reported_occurred_at ? <span className="num">{formatSast(i.reported_occurred_at)}</span> : 'not stated by the reporter'}
                </Field>
                <Field label="Received by FreightProof"><span className="num">{formatSast(i.received_at)}</span></Field>
                {i.trip_stopped_at && <Field label="Trip stopped"><span className="num">{formatSast(i.trip_stopped_at)}</span></Field>}
                <Field label="Investigated by">{i.assigned_to_name ?? 'unassigned'}</Field>
                <Field label="Affected parcels">
                  <span className="num">{i.parcels.length}</span>{unresolved > 0 && `, ${unresolved} with no finding yet`}
                </Field>
              </dl>
              {i.parcels.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-small">
                    <thead className="text-micro uppercase tracking-eyebrow text-muted">
                      <tr><th className="py-1">Parcel</th><th>Scans</th><th>Finding</th></tr>
                    </thead>
                    <tbody>
                      {i.parcels.map((p) => (
                        <tr key={p.parcel_id} className="border-t border-outline-v/40">
                          <td className="num py-1.5">{p.barcode}</td>
                          <td>{humanise(p.scan_state)}</td>
                          <td>{p.latest_finding ? humanise(p.latest_finding) : 'not established'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {i.entries.length > 0 && (
                <>
                  <Eyebrow as="h5" className="mb-1 mt-4">Investigation log</Eyebrow>
                  <ol className="space-y-1.5 border-l-2 border-outline-v/60 pl-3 text-body">
                    {i.entries.map((e) => (
                      <li key={e.sequence}>
                        <span className="num text-meta text-muted">{formatSast(e.recorded_at)}{e.recorded_by_name && ` · ${e.recorded_by_name}`}</span>
                        <span className="block">{investigationEntryText(e)}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </article>
          )
        })}
      </div>
      <p className="mt-4 text-meta text-muted">
        Investigations are the operator&apos;s own record, entered after the events they describe. Each entry is appended,
        never edited, so the first assessment and everything learned since stand side by side. A missing scan is shown as
        &ldquo;no scan in recorded&rdquo;, which is a scan fact, not a finding that a parcel was stolen.
      </p>
    </Card>
  )
}

export function DataProtection({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Data protection" id="data-protection">
      <p className="text-body">
        This pack contains personal information processed under the Protection of Personal Information Act 4 of 2013. Only
        fingerprints of records — never personal information — are published to Hedera.
      </p>
      <Eyebrow as="h4" className="mb-1 mt-3">Withheld from this pack</Eyebrow>
      <ul className="list-disc space-y-0.5 pl-5 text-body">
        {manifest.redactions.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </Card>
  )
}
