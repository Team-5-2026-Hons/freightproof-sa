import Link from 'next/link'
import type { JSX } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { fmtFull } from '@shared/lib/utils/datetime'
import type { ParcelJourney, ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import { ParcelTimeline } from './ParcelTimeline'
import { locationLabel, progressLabel, tripEvidenceLink } from './trace-display'

interface JourneyProps { journey: ParcelJourney; returnTo: string }

export function ParcelCurrentState({ trace }: { trace: ParcelTraceResponse }): JSX.Element | null {
  const latest = trace.journeys[0]
  if (!latest) return null
  const fix = latest.last_recorded_location
  return <section aria-label="Current recorded state" className="rounded-xl bg-surf-lowest p-5 shadow-level-3 sm:p-6">
    <p className="text-[11px] font-bold uppercase tracking-widest text-on-surf-v">Current recorded state · latest matching journey</p>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="break-all text-xl font-extrabold tabular-nums text-on-surf">{trace.barcode}</h2>
        <p className="mt-1 break-all text-sm text-on-surf-v">Waybill <span className="font-semibold tabular-nums">{trace.waybill_reference}</span></p>
      </div>
      <Chip type={latest.progress.position === 'cancelled' || latest.progress.has_overrides ? 'exception' : latest.progress.position === 'after_delivery' ? 'complete' : 'transit'} label={progressLabel(latest.progress, latest.phases)} />
    </div>
    <div className="mt-5 border-t border-outline-v/25 pt-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-on-surf"><Ic n="map" s={16} className="mt-0.5 shrink-0 text-sec" />{locationLabel(latest)}</p>
      {fix && <div className="mt-2 space-y-1 pl-6 text-xs text-on-surf-v">
        <p>{fix.source === 'horse_tracker' ? 'Vehicle tracker' : 'Driver phone'} · <span className="tabular-nums">{fix.captured_at ? fmtFull(fix.captured_at) : 'Capture time not recorded'}</span></p>
        <p>Phase recorded: <span className="tabular-nums">{fix.phase_completed_at ? fmtFull(fix.phase_completed_at) : 'Time unavailable'}</span></p>
        <p>Inherited from consignment evidence; this is not parcel GPS or live tracking.</p>
      </div>}
    </div>
  </section>
}

export function ParcelJourneyView({ journey, returnTo }: JourneyProps): JSX.Element {
  return <article aria-label={`Trip ${journey.trip_reference}`} className="overflow-hidden rounded-xl bg-surf-lowest shadow-level-3">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-v/25 p-5">
      <div className="min-w-0">
        <h2 className="break-all text-base font-bold tabular-nums text-on-surf">{journey.trip_reference}</h2>
        <p className="mt-1 text-sm text-on-surf-v">{journey.origin_name ?? 'Pickup unknown'} → {journey.destination_name ?? 'Delivery unknown'}</p>
        <p className="mt-1 text-xs text-on-surf-v">{journey.membership_source === 'creation_manifest' ? 'Historical manifest association · planned membership' : 'Associated consignment'} · Vehicle <span className="tabular-nums">{journey.vehicle_registration ?? 'not recorded'}</span></p>
      </div>
      <Link href={tripEvidenceLink(journey.trip_id, returnTo)} className="rounded-md bg-surf-low px-3 py-2 text-xs font-semibold text-sec">Open trip evidence →</Link>
    </header>
    <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0"><ParcelTimeline journey={journey} returnTo={returnTo} /></div>
      <aside className="row-start-1 space-y-5 xl:col-start-2 xl:row-start-auto"><EvidenceSummary journey={journey} returnTo={returnTo} /><ScanObservations journey={journey} /></aside>
    </div>
  </article>
}

function EvidenceSummary({ journey, returnTo }: JourneyProps): JSX.Element {
  return <section aria-label="Evidence summary" className="rounded-lg bg-surf-low p-4">
    <h3 className="text-sm font-bold text-on-surf">Evidence summary</h3>
    <p className="mt-2 text-xs text-on-surf-v">{progressLabel(journey.progress, journey.phases)}</p>
    {journey.gaps.length > 0 ? <ul className="mt-3 space-y-3">
      {journey.gaps.map(gap => <li key={gap} className="flex items-start gap-2 text-xs leading-relaxed text-on-surf"><Ic n="warn" s={14} className="mt-0.5 shrink-0 text-warn" /><span>{gap}</span></li>)}
    </ul> : <p className="mt-3 text-xs text-on-surf-v">Read the recorded phases and scan observations below. Receipt presence alone is not a fresh verification.</p>}
    {journey.exceptions.length > 0 && <div className="mt-4 border-t border-outline-v/30 pt-3">
      <h4 className="text-xs font-bold text-on-surf">Recorded exceptions</h4>
      <ul className="mt-2 space-y-3">{journey.exceptions.map(item => <li key={item.id} className="text-xs">
        <Link href={withReturnTo(ROUTES.exceptionDetail(item.id), returnTo)} className="font-semibold text-sec underline underline-offset-2">{item.description}</Link>
        <p className="mt-1 text-on-surf-v">{item.scope === 'trip_context' ? 'Shared trip context' : 'This consignment'} · {item.review_status === 'reviewed' ? 'Reviewed' : 'Needs review'}</p>
      </li>)}</ul>
    </div>}
  </section>
}

function ScanObservations({ journey }: { journey: ParcelJourney }): JSX.Element {
  return <section aria-label="Parcel scan observations" className="rounded-lg border border-outline-v/30 p-4">
    <h3 className="flex items-center gap-2 text-sm font-bold text-on-surf"><span aria-hidden="true" className="h-3 w-3 border border-outline" />Parcel scan observations</h3>
    <p className="mt-2 text-xs leading-relaxed text-on-surf-v">Recorded against the barcode. These fields do not identify the source system or whether it was simulated.</p>
    {journey.scans.length === 0 ? <p className="mt-3 text-xs text-on-surf-v">No retained parcel scan record for this association.</p> : journey.scans.map((scan, index) => <div key={scan.parcel_id} className="mt-4 border-t border-outline-v/25 pt-3 text-xs">
      {journey.scans.length > 1 && <p className="mb-2 font-semibold text-on-surf">Parcel record {index + 1}</p>}
      <dl className="space-y-2">
        <div><dt className="text-on-surf-v">Origin scan-out</dt><dd className="mt-1 font-semibold tabular-nums text-on-surf">{scan.scan_out_at ? fmtFull(scan.scan_out_at) : 'Not recorded'}</dd></div>
        <div><dt className="text-on-surf-v">Destination scan-in</dt><dd className={`mt-1 font-semibold tabular-nums ${scan.scan_in_at ? 'text-on-surf' : 'text-warn'}`}>{scan.scan_in_at ? fmtFull(scan.scan_in_at) : 'Not recorded'}</dd></div>
        <div><dt className="text-on-surf-v">Stored scan status</dt><dd className="mt-1 text-on-surf">{scan.status.replaceAll('_', ' ')}</dd></div>
      </dl>
    </div>)}
  </section>
}
