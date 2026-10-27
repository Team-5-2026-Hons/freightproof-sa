import type { JSX, Ref } from 'react'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { Chip } from '@/components/ui/Chip'
import { POPOVER_ANCHOR_END } from '@/components/ui/popoverAnchor'
import type { ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import { ParcelHistory } from './ParcelHistory'
import { ParcelTimeline } from './ParcelTimeline'
import { statusBadge, statusLine } from './trace-display'

interface Props {
  trace: ParcelTraceResponse
  returnTo: string
  headingRef?: Ref<HTMLHeadingElement>
  loadingMore: boolean
  onLoadMore: () => void
}

const POPOVER_TITLE = 'Parcel record'
const POPOVER_LABEL = 'How to read this parcel record'
const SCAN_CAVEAT = 'Parcel scans are recorded against the barcode. They do not identify the source system or whether it was simulated.'
const POSITION_CAVEAT = 'Vehicle and phone positions are inherited from consignment evidence; they are not parcel GPS or live tracking.'
const SEALED_CAVEAT = 'The contents of a sealed leg are not observable.'

/**
 * The parcel's answer in one card: identity and status, one status line, the timeline of what was recorded for the latest journey,
 * and, at the bottom, the earlier trips. Earlier journeys appear only as collapsed rows there.
 */
export function ParcelOverview({ trace, returnTo, headingRef, loadingMore, onLoadMore }: Props): JSX.Element {
  const latest = trace.journeys[0]
  const badge = latest ? statusBadge(latest) : null
  return <section aria-label="Current recorded state" className="space-y-3 rounded-xl bg-surf-lowest p-5 shadow-level-3 sm:p-6">
    <header className="min-w-0 space-y-1">
      <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 ref={headingRef} tabIndex={-1} className="min-w-0 break-all rounded text-xl font-extrabold tabular-nums text-on-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec">{trace.barcode}</h2>
        <div className="flex items-center gap-2">
          {badge && <Chip {...badge} className="!whitespace-normal" />}
          <span className={POPOVER_ANCHOR_END}>
            <InfoPopover title={POPOVER_TITLE} ariaLabel={POPOVER_LABEL} question={POPOVER_LABEL} basis={SCAN_CAVEAT} note={POSITION_CAVEAT} source={trace.coverage_note} footnote={SEALED_CAVEAT} />
          </span>
        </div>
      </div>
      {latest && <p className="break-words text-sm text-on-surf-v">{`Waybill ${trace.waybill_reference} · ${latest.origin_name ?? 'Pickup unknown'} → ${latest.destination_name ?? 'Delivery unknown'}`}</p>}
      {!latest && <p className="break-all text-sm text-on-surf-v">Waybill <span className="font-semibold tabular-nums">{trace.waybill_reference}</span></p>}
    </header>
    {latest ? <>
      <p data-status-line className="text-sm font-semibold leading-relaxed text-on-surf">{statusLine(latest)}</p>
      <ParcelTimeline journey={latest} returnTo={returnTo} />
      <ParcelHistory trace={trace} returnTo={returnTo} loadingMore={loadingMore} onLoadMore={onLoadMore} />
    </> : <p className="text-sm text-on-surf-v">No associated journey is recorded</p>}
  </section>
}
