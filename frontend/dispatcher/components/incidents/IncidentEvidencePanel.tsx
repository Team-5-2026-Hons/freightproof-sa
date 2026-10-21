'use client'

import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { Button } from '@/components/ui/Button'
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
  return <h3 className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">{children}</h3>
}

/**
 * Everything the decision rests on, together: scans per consignment, seal readings, counts,
 * the last known position, tracking gaps and every exception on the trip. Built server-side
 * from the same manifest the audit pack uses, so the two cannot disagree.
 */
export function IncidentEvidencePanel({ evidence, incidentId, closed, onLinkException }: Props): React.JSX.Element {
  const position = evidence.last_known_position
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <Heading>Scans by consignment</Heading>
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
        <p className="text-xs text-on-surf-v">A missing scan-in is what the scanners recorded, not a finding that a parcel was taken.</p>
      </section>

      <section className="flex flex-col gap-2">
        <Heading>Seals</Heading>
        {evidence.seals.length === 0 ? <p className="text-sm text-on-surf-v">No seal readings recorded.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {evidence.seals.map(s => (
              <li key={s.phase_event_id} className="tabular-nums">
                <span className="font-semibold capitalize">{s.phase_type.replace('_', ' ')}</span>
                {s.precinct_name ? ` at ${s.precinct_name}` : ''}: {s.seal_number ?? 'no number'}
                {s.seal_condition ? ` · ${s.seal_condition}` : ''}{s.completed_at ? ` · ${fmtSastDateTime(s.completed_at)}` : ''}
                {s.photo_ids.length > 0 && <span className="text-on-surf-v"> · {s.photo_ids.length} photo{s.photo_ids.length === 1 ? '' : 's'}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {evidence.counts.length > 0 && <section className="flex flex-col gap-2">
        <Heading>Counts</Heading>
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
      </section>}

      <section className="flex flex-col gap-2">
        <Heading>Last known position</Heading>
        {position ? (
          <p className="text-sm tabular-nums">
            {position.lat.toFixed(COORDINATE_DECIMALS)}, {position.lng.toFixed(COORDINATE_DECIMALS)} · {SOURCE_LABEL[position.source]}
            {position.recorded_at ? ` · ${fmtSastDateTime(position.recorded_at)}` : ''}
          </p>
        ) : <p className="text-sm text-on-surf-v">No position fix before the reported time.</p>}
        <p className="text-xs text-on-surf-v">Read at {fmtSastDateTime(evidence.position_reference_time)}, the reported time (or when we were told).</p>
        {evidence.coverage_gaps.length > 0 && (
          <p className="text-xs text-on-surf-v">
            Tracking gaps: {evidence.coverage_gaps.map(g => `${fmtSastDateTime(g.start)} for ${g.minutes} min`).join('; ')}
          </p>
        )}
      </section>

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

      {evidence.observations.some(o => o.level === 'attention') && <section className="flex flex-col gap-2">
        <Heading>Needs attention</Heading>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {evidence.observations.filter(o => o.level === 'attention').map(o => <li key={`${o.code}-${o.text}`}>{o.text}</li>)}
        </ul>
      </section>}
    </div>
  )
}
