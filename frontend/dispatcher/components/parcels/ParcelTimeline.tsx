import Link from 'next/link'
import type { JSX } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { fmtFull } from '@shared/lib/utils/datetime'
import type { ParcelJourney, ParcelSealWindow, ParcelTracePhase } from '@shared/lib/types/parcel-trace'
import { LOCATION_LABELS, SEAL_LABELS, phaseStatus, tripEvidenceLink } from './trace-display'

interface TimelineProps { journey: ParcelJourney; returnTo: string }

export function ParcelTimeline({ journey, returnTo }: TimelineProps): JSX.Element {
  const windows = new Map(journey.seal_windows.map(window => [window.departure_phase_id, window]))
  const grouped = new Set(journey.seal_windows.flatMap(window => window.phase_ids))
  return <section aria-label={`Journey timeline for ${journey.trip_reference}`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[15px] font-bold text-on-surf">Recorded journey</h3>
      <span className="text-xs text-on-surf-v">Consignment evidence · ledger order</span>
    </div>
    {journey.phases.length === 0 && <p className="text-sm text-on-surf-v">No phase ledger recorded.</p>}
    <ol className="space-y-3">
      {journey.phases.map(phase => {
        const window = windows.get(phase.id)
        if (window) return <li key={phase.id}><SealBand window={window} journey={journey} returnTo={returnTo} /></li>
        if (grouped.has(phase.id)) return null
        return <li key={phase.id}><PhaseEntry phase={phase} journey={journey} returnTo={returnTo} /></li>
      })}
    </ol>
  </section>
}

function SealBand({ window, journey, returnTo }: TimelineProps & { window: ParcelSealWindow }): JSX.Element {
  const phases = journey.phases.filter(phase => window.phase_ids.includes(phase.id))
  const type = window.status === 'matched' ? 'complete' : window.status === 'pending' ? 'pending' : 'exception'
  return <section aria-label={`Custody leg from ${window.origin_name ?? 'unknown origin'}`} className="rounded-lg border border-outline-v/50 bg-surf-low/50 p-3 sm:p-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 gap-2">
        <Ic n="lock" s={17} className="mt-0.5 shrink-0 text-on-surf-v" />
        <div>
          <h4 className="text-sm font-bold text-on-surf">Sealed-load custody leg</h4>
          <p className="mt-1 text-xs text-on-surf-v">Contents not observable · {window.origin_name ?? 'Origin not recorded'} → {window.destination_name ?? 'Next inspection'}</p>
          <p className="mt-1 break-all text-xs font-semibold tabular-nums text-on-surf">Departure seal: {window.departure_seal ?? 'Not recorded'}</p>
        </div>
      </div>
      <Chip type={type} label={SEAL_LABELS[window.status]} />
    </div>
    <ol className="space-y-3 border-l-2 border-outline-v/50 pl-3 sm:pl-4">
      {phases.map(phase => <li key={phase.id}><PhaseEntry phase={phase} journey={journey} returnTo={returnTo} /></li>)}
    </ol>
  </section>
}

function PhaseEntry({ phase, journey, returnTo }: TimelineProps & { phase: ParcelTracePhase }): JSX.Element {
  const status = phaseStatus(phase, journey.trip_status === 'cancelled')
  const isCurrent = journey.progress.position === 'within_journey' && journey.progress.phase_event_id === phase.id
  const observed = phase.status === 'completed' || phase.status === 'exception'
  const findings = journey.exceptions.filter(item => item.phase_event_id === phase.id)
  return <details className={`group rounded-lg border bg-surf-lowest p-3 sm:p-4 ${isCurrent ? 'border-sec/40' : 'border-outline-v/25'}`}>
    <summary className="cursor-pointer rounded text-sm marker:text-outline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">
      <span className="inline-flex max-w-full flex-wrap items-center gap-2 align-middle">
        <span className="font-bold text-on-surf">{PHASE_NAMES[phase.phase_type]}</span>
        <Chip {...status} />
        {isCurrent && <span className="text-xs font-semibold text-sec">Current phase</span>}
      </span>
      <span className="mt-2 block text-xs text-on-surf-v">{phase.precinct_name ?? 'Trip-wide record'} · {phase.relevance === 'consignment' ? 'Inherited consignment evidence' : 'Trip context'}</span>
      <span className="mt-1 block text-xs font-semibold tabular-nums text-sec">{phase.completed_at ? <time dateTime={phase.completed_at}>{fmtFull(phase.completed_at)}</time> : 'Completion not recorded'}</span>
      {observed && phase.phase_type !== 'trip_creation' && <span className={`mt-2 block text-xs ${phase.location_verdict === 'unwitnessed' || phase.location_verdict === 'mismatch' ? 'font-semibold text-warn' : 'text-on-surf-v'}`}>{LOCATION_LABELS[phase.location_verdict]}</span>}
      {findings.length > 0 && <span className="mt-2 block text-xs font-semibold text-warn">{findings.length} linked {findings.length === 1 ? 'exception' : 'exceptions'}</span>}
    </summary>
    <div className="mt-4 space-y-3 border-t border-outline-v/25 pt-3 text-xs text-on-surf-v">
      <p>Device capture: <span className="tabular-nums">{phase.driver_captured_at ? fmtFull(phase.driver_captured_at) : 'Not recorded'}</span></p>
      {phase.seal_number && <p>Recorded seal: <span className="break-all font-semibold tabular-nums text-on-surf">{phase.seal_number}</span>{phase.seal_condition ? ` · ${phase.seal_condition}` : ''}</p>}
      {phase.override_note && <p className="rounded bg-warn-c/30 p-3 text-on-surf">Override note: {phase.override_note}</p>}
      {observed && <p>{phase.anchor_status === 'anchored' ? 'An anchor is recorded for this phase. Verify it in trip evidence.' : phase.anchor_status === 'failed' ? 'Phase anchor failed; the event is still recorded.' : phase.anchor_status === 'pending' ? 'Phase anchor is pending.' : 'No anchor is required for this record.'}</p>}
      {findings.map(item => <p key={item.id} className="rounded bg-warn-c/30 p-3 text-on-surf">{item.description} <span className="block pt-1 text-on-surf-v">{item.scope === 'consignment' ? 'This consignment' : 'Shared trip context'} · {fmtFull(item.recorded_at)}</span></p>)}
      <Link className="inline-flex min-h-8 items-center gap-1 font-semibold text-sec underline underline-offset-4" href={tripEvidenceLink(journey.trip_id, returnTo, phase.id)}>Open phase evidence <Ic n="chev" s={12} /></Link>
    </div>
  </details>
}
