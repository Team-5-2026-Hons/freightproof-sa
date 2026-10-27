import { formatRand, formatSast, humanise, pluralise } from '@/lib/format'
import { cargoTotals, incidentBreakAfter } from '@/lib/overview'
import type { TimelineItem } from '@/lib/timeline'
import type { AuditPackManifest } from '@/lib/types'
import { Eyebrow } from './Eyebrow'
import { tierLabel } from './TierBadge'

function Tile({ label, value, sub, flag = false }: { label: string; value: string; sub: string; flag?: boolean }) {
  return (
    <div className="min-w-0 border-t border-white/20 pt-2.5">
      <Eyebrow as="dt" tone="onDark">{label}</Eyebrow>
      <dd className={`mt-0.5 text-head font-bold leading-snug ${flag ? 'text-err-c' : ''}`}>{value}</dd>
      <dd className="mt-0.5 text-meta text-white/70">{sub}</dd>
    </div>
  )
}

/** The four facts a claims handler needs before reading anything else; the PDF cover leads with the same. */
export function AtAGlance({ manifest }: { manifest: AuditPackManifest }) {
  const { stops, trip, incident, exceptions, observations } = manifest
  const cargo = cargoTotals(manifest)
  const critical = exceptions.filter((e) => e.severity === 'critical').length
  const attention = observations.filter((o) => o.level === 'attention').length
  const first = stops[0]
  const last = stops.length > 1 ? stops[stops.length - 1] : null
  const unvalued = cargo.consignments - cargo.valued
  return (
    <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Route"
        value={first ? `${first.precinct_name}${last ? ` → ${last.precinct_name}` : ''}` : '—'}
        sub={`${pluralise(stops.length, 'stop')} · ${humanise(trip.trip_type)}`}
      />
      <Tile
        label="Cargo"
        value={cargo.declaredValue ? formatRand(cargo.declaredValue) : 'Value not declared'}
        sub={`${pluralise(cargo.consignments, 'consignment')} · ${pluralise(cargo.parcels, 'parcel')}${cargo.valued > 0 && unvalued > 0 ? ` · ${unvalued} without a value` : ''}`}
      />
      <Tile
        label="Trip status"
        value={humanise(trip.status)}
        flag={incident != null}
        sub={incident
          ? `${humanise(incident.first_exception_type)} reported ${formatSast(incident.first_raised_at)}`
          : trip.closed_at ? `Closed ${formatSast(trip.closed_at)}` : 'Not closed when generated'}
      />
      <Tile
        label="Exceptions"
        value={`${exceptions.length} raised`}
        sub={`${critical} critical · ${pluralise(attention, 'observation')} need${attention === 1 ? 's' : ''} attention`}
      />
    </dl>
  )
}

const DOT = {
  pending: 'border-outline-v bg-surf-lowest',
  anchored: 'border-chain bg-chain',
  done: 'border-ink bg-ink',
} as const

/**
 * The custody phases as one line — the pack's signature. The rule turns red and dashed after the
 * last phase completed before the incident; the sentence under it says the same thing in words.
 */
export function JourneyStrip({ manifest, items }: { manifest: AuditPackManifest; items: TimelineItem[] }) {
  const phases = items
    .filter((i): i is Extract<TimelineItem, { kind: 'phase' }> => i.kind === 'phase')
    .sort((a, b) => a.record.sequence_number - b.record.sequence_number)
  if (phases.length === 0) return <p className="text-body text-muted">No custody phases recorded.</p>
  const breakAfter = incidentBreakAfter(manifest)
  const incident = manifest.incident
  const cut = (nextSequence: number) => incident != null && (breakAfter === null || nextSequence > breakAfter)
  const rule = (isCut: boolean) => (isCut ? 'border-dashed border-err' : 'border-ink')
  return (
    <>
      <div className="-mx-1 overflow-x-auto pb-1">
        <ol aria-label="Custody journey" className="flex min-w-max sm:min-w-0">
          {phases.map((item, i) => {
            const p = item.record
            const state = item.pending ? 'pending' : item.tier === 'anchored' ? 'anchored' : 'done'
            const previous = phases[i - 1]
            const next = phases[i + 1]
            return (
              <li key={p.phase_event_id} className="relative min-w-[92px] flex-1 px-1 text-center">
                {previous && <span aria-hidden className={`absolute left-0 right-1/2 top-[9px] border-t-2 ${rule(cut(p.sequence_number))}`} />}
                {next && <span aria-hidden className={`absolute left-1/2 right-0 top-[9px] border-t-2 ${rule(cut(next.record.sequence_number))}`} />}
                <span
                  aria-hidden
                  className={`relative mx-auto block h-5 w-5 rounded-full border-2 ${DOT[state]} ${breakAfter === p.sequence_number ? 'ring-2 ring-err ring-offset-2' : ''}`}
                />
                <span className="num mt-2 block text-caption font-bold text-muted">P{p.sequence_number}</span>
                <span className={`block text-small leading-tight ${item.pending ? 'text-muted' : 'font-semibold'}`}>{humanise(p.phase_type)}</span>
                <span className="mt-0.5 block text-micro font-semibold uppercase tracking-[0.06em] text-muted">
                  {item.pending ? 'Pending' : tierLabel(item.tier)}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="mt-3 text-meta text-muted">
        Filled: completed · teal: anchored on Hedera · hollow: not completed.
        {incident && (
          <span className="font-semibold text-err">
            {' '}Red break: {humanise(incident.first_exception_type)} reported {formatSast(incident.first_raised_at)}
            {breakAfter !== null ? `, after P${breakAfter} was completed.` : ', before any phase was completed.'}
          </span>
        )}
      </p>
    </>
  )
}
