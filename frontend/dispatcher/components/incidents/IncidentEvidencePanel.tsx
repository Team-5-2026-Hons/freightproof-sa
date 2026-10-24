'use client'

import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { exceptionDescriptionText, fmtExceptionType } from '@/lib/format/exception'
import type { IncidentEvidence } from '@/lib/types/incident'

interface Props {
  evidence: IncidentEvidence
  incidentId: string
  closed: boolean
  onLinkException: (exceptionId: string) => void
}

const SOURCE_LABEL = { driver_phone: 'driver phone', vehicle_tracker: 'vehicle tracker', trailer_tracker: 'trailer tracker' } as const
// The coordinates a SAPS docket asks for: five decimals is about a metre.
const COORDINATE_DECIMALS = 5

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Same weight as a Disclosure title, so the two open blocks and the folded ones read as one list.
  return <h3 className="text-sm font-bold text-on-surf">{children}</h3>
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0)
}

/**
 * What the dispatcher should read first, then the facts behind it. "Needs attention" and the
 * exceptions (which carry the only actions) stay open; scans, seals, counts, position and
 * tracking gaps fold away, each with a summary line saying what is inside so the reader can
 * tell whether to open it. Built server-side from the same manifest the audit pack uses, so
 * the two cannot disagree.
 */
export function IncidentEvidencePanel({ evidence, incidentId, closed, onLinkException }: Props): React.JSX.Element {
  const position = evidence.last_known_position
  const attention = evidence.observations.filter(o => o.level === 'attention')
  const noScanIn = sum(evidence.consignments.map(c => c.no_scan_in_recorded))
  const photos = sum(evidence.seals.map(s => s.photo_ids.length))
  const gapMinutes = sum(evidence.coverage_gaps.map(g => g.minutes))

  return (
    <div className="flex flex-col gap-6">
      {attention.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-outline-v/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-warn" />
            <Heading>Needs attention</Heading>
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-on-surf">
            {attention.map(o => <li key={`${o.code}-${o.text}`}>{o.text}</li>)}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <Heading>Exceptions on this trip</Heading>
        {evidence.trip_exceptions.length === 0 ? <p className="text-sm text-on-surf-v">No exceptions recorded.</p> : (
          <ul className="flex flex-col divide-y divide-outline-v/30">
            {evidence.trip_exceptions.map(e => (
              <li key={e.exception_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{fmtExceptionType(e.exception_type)} <span className="font-normal text-on-surf-v">· {e.severity} · {fmtSastDateTime(e.raised_at)}</span></p>
                  <p className="text-on-surf-v">{exceptionDescriptionText(e)}</p>
                </div>
                {e.incident_id === incidentId ? <span className="text-xs font-semibold text-ok">Grouped here</span>
                  : e.incident_id ? <span className="text-xs text-on-surf-v">In another incident</span>
                    : !closed && <Button size="sm" variant="secondary" onClick={() => onLinkException(e.exception_id)}>Group here</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="divide-y divide-outline-v border-t border-outline-v">
        <Disclosure id="incident-evidence-scans" title="Scans" summary={
          evidence.consignments.length === 0 ? 'no consignments on this trip'
            : `${plural(evidence.consignments.length, 'consignment')} · ${sum(evidence.consignments.map(c => c.scanned_in))} scanned in${noScanIn > 0 ? ` · ${noScanIn} with no scan-in` : ''}`
        }>
          {evidence.consignments.length === 0 ? <p className="text-sm text-on-surf-v">No consignments on this trip.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-on-surf-v">
                <tr><th className="py-1 font-semibold">Consignment</th><th className="py-1 font-semibold">Expected</th><th className="py-1 font-semibold">Scanned out</th><th className="py-1 font-semibold">Scanned in</th><th className="py-1 font-semibold">No scan-in recorded</th></tr>
              </thead>
              <tbody className="tabular-nums">
                {evidence.consignments.map(c => (
                  <tr key={c.consignment_id} className="border-t border-outline-v/30">
                    <td className="py-2">{c.reference}</td>
                    <td className="py-2">{c.parcel_count_expected ?? '—'}</td>
                    <td className="py-2">{c.scanned_out}</td>
                    <td className="py-2">{c.scanned_in}</td>
                    <td className={c.no_scan_in_recorded > 0 ? 'py-2 font-semibold text-warn' : 'py-2'}>{c.no_scan_in_recorded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-on-surf-v">A missing scan-in is what the scanners recorded, not a finding that a parcel was taken.</p>
        </Disclosure>

        <Disclosure id="incident-evidence-seals" title="Seals" summary={
          evidence.seals.length === 0 ? 'none recorded'
            : `${plural(evidence.seals.length, 'reading')}${photos > 0 ? ` · ${plural(photos, 'photo')}` : ''}`
        }>
          {evidence.seals.length === 0 ? <p className="text-sm text-on-surf-v">No seal readings recorded.</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {evidence.seals.map(s => (
                <li key={s.phase_event_id} className="tabular-nums">
                  <span className="font-semibold capitalize">{s.phase_type.replace('_', ' ')}</span>
                  {s.precinct_name ? ` at ${s.precinct_name}` : ''}: {s.seal_number ?? 'no number'}
                  {s.seal_condition ? ` · ${s.seal_condition}` : ''}{s.completed_at ? ` · ${fmtSastDateTime(s.completed_at)}` : ''}
                  {s.photo_ids.length > 0 && <span className="text-on-surf-v"> · {plural(s.photo_ids.length, 'photo')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>

        <Disclosure id="incident-evidence-counts" title="Counts" summary={
          evidence.counts.length === 0 ? 'none recorded' : `${plural(evidence.counts.length, 'phase')} counted`
        }>
          {evidence.counts.length === 0 ? <p className="text-sm text-on-surf-v">No parcel counts recorded.</p> : (
            <ul className="flex flex-col gap-1 text-sm tabular-nums">
              {evidence.counts.map(c => (
                <li key={c.phase_event_id}>
                  <span className="font-semibold capitalize">{c.phase_type.replace('_', ' ')}</span>
                  {c.parcel_count_origin !== null ? ` · origin ${c.parcel_count_origin}` : ''}
                  {c.parcel_count_destination !== null ? ` · destination ${c.parcel_count_destination}` : ''}
                  {c.driver_visual_count !== null ? ` · driver counted ${c.driver_visual_count}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>

        <Disclosure id="incident-evidence-position" title="Last known position" summary={
          position
            ? `${SOURCE_LABEL[position.source]}${position.recorded_at ? ` · ${fmtSastDateTime(position.recorded_at)}` : ''}`
            : 'no fix before the reported time'
        }>
          {position ? (
            <p className="text-sm tabular-nums">
              {position.lat.toFixed(COORDINATE_DECIMALS)}, {position.lng.toFixed(COORDINATE_DECIMALS)} · {SOURCE_LABEL[position.source]}
              {position.recorded_at ? ` · ${fmtSastDateTime(position.recorded_at)}` : ''}
            </p>
          ) : <p className="text-sm text-on-surf-v">No position fix before the reported time.</p>}
          <p className="mt-2 text-xs text-on-surf-v">Read at {fmtSastDateTime(evidence.position_reference_time)}, the reported time (or when we were told).</p>
        </Disclosure>

        <Disclosure id="incident-evidence-gaps" title="Tracking gaps" summary={
          evidence.coverage_gaps.length === 0 ? 'none recorded' : `${plural(evidence.coverage_gaps.length, 'gap')} · ${gapMinutes} min`
        }>
          {evidence.coverage_gaps.length === 0 ? <p className="text-sm text-on-surf-v">No tracking gaps recorded.</p> : (
            <ul className="flex flex-col gap-1 text-sm tabular-nums">
              {evidence.coverage_gaps.map(g => <li key={g.start}>{fmtSastDateTime(g.start)} for {g.minutes} min</li>)}
            </ul>
          )}
        </Disclosure>
      </div>
    </div>
  )
}
