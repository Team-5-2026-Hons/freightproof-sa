'use client'

import { useState } from 'react'
import { incidentSheetUrl } from '@/lib/api'
import { formatCoord, formatRand, formatSast, humanise } from '@/lib/format'
import { mirrorMessageUrl } from '@/lib/verify'
import type { AuditPackManifest, ExceptionRecord, PublicPackSeal } from '@/lib/types'
import { Card, Field } from './Card'
import { TIER_ORDER, TierBadge, tierMeaning } from './TierBadge'

export function Observations({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Observations" id="observations" aside={<span className="text-[11px] text-muted">What the record shows — not findings of fault</span>}>
      <ul className="space-y-1.5">
        {manifest.observations.map((o, i) => (
          <li
            key={`${o.code}-${i}`}
            className={`rounded-md border-l-[3px] px-3 py-2 text-[13px] ${o.level === 'attention' ? 'border-err bg-err-c/40' : 'border-outline-v bg-surf-low'}`}
          >
            {o.text}
          </li>
        ))}
        {manifest.observations.length === 0 && <li className="text-[13px] text-muted">No observations.</li>}
      </ul>
    </Card>
  )
}

export function TierLegend() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {TIER_ORDER.map((tier) => (
        <li key={tier} className="flex items-start gap-2 text-[12px]">
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
  return (
    <Card
      title="Incident summary"
      id="incident"
      aside={<a href={incidentSheetUrl(token)} className="no-print text-[12px] font-semibold text-sec underline">Download incident fact sheet</a>}
    >
      <dl>
        <Field label="First critical event">
          <button type="button" className="font-semibold text-sec underline" onClick={() => onSelect(incident.exception_ids[0])}>
            {humanise(incident.first_exception_type)}
          </button>{' '}
          <span className="num">{formatSast(incident.first_raised_at)}</span>
        </Field>
        <Field label="Where it was raised"><span className="num">{formatCoord(incident.position)}</span></Field>
        <Field label="Last known position at or before it">
          <span className="num">{formatCoord(incident.last_known_position)}</span>
          {incident.last_known_position && (
            <span className="text-muted"> · {humanise(incident.last_known_position.source)} · {formatSast(incident.last_known_position.recorded_at)}</span>
          )}
        </Field>
        <Field label="First dispatcher review">
          {incident.first_reviewed_at
            ? <span className="num">{formatSast(incident.first_reviewed_at)} ({incident.minutes_to_first_review} min after)</span>
            : <span className="font-semibold text-err">No review recorded</span>}
        </Field>
      </dl>
      <h3 className="mb-1 mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
        Police report and notifications <TierBadge tier="declared" />
      </h3>
      {declarations.length === 0 && (
        <p className="text-[12px] text-muted">
          No police report or notification times have been declared by the operator. A claim will need the SAPS station and case number.
        </p>
      )}
      <ul className="space-y-2">
        {declarations.map((d) => (
          <li key={d.declaration_id} className="rounded-md border border-dashed border-warn/60 px-3 py-2 text-[13px]">
            {(d.saps_station || d.saps_cas_number) && (
              <p>SAPS {d.saps_station ?? ''}{d.saps_cas_number && <span className="num font-semibold"> · CAS {d.saps_cas_number}</span>}{d.saps_officer && ` · ${d.saps_officer}`}</p>
            )}
            {d.reported_to_saps_at && <p className="num">Reported to SAPS {formatSast(d.reported_to_saps_at)}</p>}
            {d.tracking_company_notified_at && <p className="num">Tracking company told {formatSast(d.tracking_company_notified_at)}</p>}
            {d.client_notified_at && <p className="num">Client told {formatSast(d.client_notified_at)}</p>}
            {d.insurer_notified_at && <p className="num">Insurer told {formatSast(d.insurer_notified_at)}</p>}
            {d.insurer_claim_reference && <p>Claim ref <span className="num">{d.insurer_claim_reference}</span></p>}
            {d.note && <p className="text-muted">{d.note}</p>}
            <p className="mt-1 text-[11px] text-muted">Declared {formatSast(d.declared_at)}{d.declared_by_name && ` by ${d.declared_by_name}`}; not captured by FreightProof.</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function Parties({ manifest }: { manifest: AuditPackManifest }) {
  const { trip, driver } = manifest
  return (
    <Card title="Trip, vehicles and driver" id="parties">
      <dl>
        <Field label="Operator">{trip.operator_name}</Field>
        <Field label="Client(s)">{trip.client_names.join(', ') || '—'}</Field>
        <Field label="Order number"><span className="num">{trip.order_number}</span></Field>
        <Field label="Created / closed"><span className="num">{formatSast(trip.created_at)} / {formatSast(trip.closed_at)}</span></Field>
        <Field label="Status">{humanise(trip.status)}</Field>
      </dl>
      <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Stops</h3>
      <ol className="space-y-1 text-[13px]">
        {manifest.stops.map((s) => (
          <li key={s.trip_stop_id}>
            <span className="num font-semibold">{s.sequence}.</span> {s.precinct_name}
            {s.address && <span className="text-muted"> · {s.address}</span>}
            {s.slot_time && <span className="num text-muted"> · slot {formatSast(s.slot_time)}</span>}
          </li>
        ))}
      </ol>
      <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Vehicles</h3>
      <dl>
        {manifest.vehicles.map((v) => (
          <Field key={v.vehicle_id} label={humanise(v.role)}>
            <span className="num font-semibold">{v.registration}</span>
            {(v.make || v.model) && <span> · {[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>}
            <span className="block text-[12px] text-muted">
              Tracker {v.tracker_device_id} · licence disc {v.licence_disc_expiry ?? 'not recorded'}
              {v.licence_disc_valid_on_trip_date === false && <span className="font-semibold text-err"> (expired on trip date)</span>}
            </span>
          </Field>
        ))}
      </dl>
      <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Driver</h3>
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
            {s.original_driver_name} → {s.substituting_driver_name} at {s.exchange_location}, {formatSast(s.substitution_at)} <TierBadge tier={s.tier} />
          </Field>
        ))}
      </dl>
      {manifest.record_changes.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Record changes during the trip</h3>
          <ul className="space-y-1 text-[13px]">
            {manifest.record_changes.map((c) => (
              <li key={`${c.subject_id}-${c.changed_at}`}>
                {humanise(c.subject)} · {c.changed_fields.join(', ') || humanise(c.event_type)} · <span className="num">{formatSast(c.changed_at)}</span> <TierBadge tier={c.tier} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

export function Cargo({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Cargo and consignments" id="cargo">
      {manifest.consignments.length === 0 && <p className="text-[13px] text-muted">No consignments are linked to this trip.</p>}
      <div className="space-y-4">
        {manifest.consignments.map((c) => (
          <div key={c.consignment_id}>
            <h3 className="text-[13px] font-extrabold">
              <span className="num">{c.parcel_perfect_reference}</span>{c.client_name && <span className="font-semibold text-muted"> · {c.client_name}</span>}
            </h3>
            <dl>
              <Field label="Declared value"><span className="num">{formatRand(c.declared_value)}</span></Field>
              <Field label="Parcels expected"><span className="num">{c.parcel_count_expected ?? '—'}</span></Field>
            </dl>
            {c.parcels.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-[0.1em] text-muted">
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
    <Card title="Exceptions and response log" id="exceptions" aside={<TierBadge tier="recorded" />}>
      {exceptions.length === 0 && <p className="text-[13px] text-muted">No exceptions recorded.</p>}
      <ul className="space-y-2">
        {exceptions.map((e, i) => (
          <li key={e.exception_id} className="rounded-md bg-surf-low px-3 py-2 text-[13px]">
            <button type="button" onClick={() => onSelect(e.exception_id)} className="text-left font-semibold text-sec underline">
              E{i + 1} · {humanise(e.exception_type)}
            </button>
            <span className={`ml-2 text-[11px] font-bold uppercase ${e.severity === 'critical' ? 'text-err' : 'text-muted'}`}>{e.severity}</span>
            <span className="num block text-[12px] text-muted">{formatSast(e.raised_at)} · {humanise(e.source)}</span>
            <span className="block">{e.description}</span>
            <span className="block text-[12px] text-muted">
              Review: {humanise(e.review_status)}
              {e.reviewed_at && `, ${formatSast(e.reviewed_at)}`}{e.reviewer_name && ` by ${e.reviewer_name}`}
              {e.contact_method && ` via ${e.contact_method}`}{e.review_note && ` — “${e.review_note}”`}
            </span>
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
        <ul className="mt-2 space-y-1 text-[12px]">
          {coverage.gaps.map((g) => (
            <li key={g.start} className="num">{formatSast(g.start)} → {formatSast(g.end)} · {g.minutes} min</li>
          ))}
        </ul>
      )}
      {coverage.stationary_periods.length > 0 && (
        <>
          <h3 className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Stationary outside route precincts</h3>
          <ul className="space-y-1 text-[12px]">
            {coverage.stationary_periods.map((s) => (
              <li key={s.start} className="num">{formatSast(s.start)} → {formatSast(s.end)} · {s.minutes} min · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 rounded-md border-l-[3px] border-warn-c bg-[#fffbea] px-3 py-2 text-[12px]">
        Phone positions are recorded only while the driver app is in use; the vehicle tracker is queried at handshakes and
        checkpoints. The absence of a position is not evidence that the vehicle was stationary.
      </p>
    </Card>
  )
}

export function Integrity({ manifest, seal }: { manifest: AuditPackManifest; seal: PublicPackSeal }) {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(id)
  }
  return (
    <Card title="Integrity appendix" id="integrity">
      <p className="text-[13px] text-muted">
        To check a record without this page: SHA-256 the canonical payload exactly as shown (UTF-8), compare it with the data
        hash, then read the Hedera mirror-node address, base64-decode its <code>message</code>, and compare again.
      </p>
      <ul className="mt-3 space-y-3">
        {manifest.anchored_records.map((r) => (
          <li key={r.receipt_id} className="rounded-md bg-surf-low p-3 text-[12px]">
            <p className="font-semibold">{humanise(r.receipt_type)} · {humanise(r.subject_type)}</p>
            <p className="num break-all">Data hash {r.data_hash}</p>
            {r.hedera_topic_id && r.hedera_sequence_number != null && (
              <a
                className="num break-all text-sec underline"
                href={mirrorMessageUrl(seal.mirror_base_url, r.hedera_topic_id, r.hedera_sequence_number)}
                target="_blank" rel="noreferrer noopener"
              >
                {mirrorMessageUrl(seal.mirror_base_url, r.hedera_topic_id, r.hedera_sequence_number)}
              </a>
            )}
            <pre className="num mt-2 whitespace-pre-wrap break-all rounded-sm bg-surf-lowest p-2 text-[11px]">{r.canonical_payload}</pre>
            <button type="button" onClick={() => void copy(r.receipt_id, r.canonical_payload)} className="no-print mt-1 text-[12px] font-semibold text-sec">
              {copied === r.receipt_id ? 'Copied' : 'Copy payload'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function DataProtection({ manifest }: { manifest: AuditPackManifest }) {
  return (
    <Card title="Data protection" id="data-protection">
      <p className="text-[13px]">
        This pack contains personal information processed under the Protection of Personal Information Act 4 of 2013. Only
        fingerprints of records — never personal information — are published to Hedera.
      </p>
      <h3 className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Withheld from this pack</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
        {manifest.redactions.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </Card>
  )
}
