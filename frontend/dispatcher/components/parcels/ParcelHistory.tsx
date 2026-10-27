import type { JSX } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import type { ParcelTraceResponse } from '@shared/lib/types/parcel-trace'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { ParcelTimeline } from './ParcelTimeline'
import type { HeadingLevel } from './trace-display'

interface Props { trace: ParcelTraceResponse; returnTo: string; loadingMore: boolean; onLoadMore: () => void }

const ROW_TIMELINE_HEADING_LEVEL: HeadingLevel = 5
const SUMMARY_CLASS = 'flex min-h-11 cursor-pointer list-none items-start gap-2 rounded py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec [&::-webkit-details-marker]:hidden'
const WRAPPING_CHIP = '!whitespace-normal'

/**
 * The earlier-trips section at the bottom of the overview card: one compact row per earlier journey, each opening to that
 * journey's own timeline. Every row is an uncontrolled native <details> keyed by trip ID, so the browser keeps open state
 * when a continuation page appends more journeys.
 */
export function ParcelHistory({ trace, returnTo, loadingMore, onLoadMore }: Props): JSX.Element | null {
  const [latest, ...earlier] = trace.journeys
  if (!latest) return null
  const hasMore = trace.next_cursor !== null
  if (earlier.length === 0 && !hasMore) return null
  return <section className="mt-4 border-t border-outline-v/25 pt-4">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="text-sm font-bold text-on-surf">Earlier trips</h3>
      <span data-earlier-count className="text-xs text-on-surf-v">{`${earlier.length} loaded${hasMore ? ' · more available' : ''}`}</span>
    </div>
    <div className="mt-1 divide-y divide-outline-v/25">
      {earlier.map(journey => {
        const status = TRIP_STATUS_META[journey.trip_status]
        return <details key={journey.trip_id} data-trip-id={journey.trip_id} className="group">
          <summary className={SUMMARY_CLASS}>
            <Ic n="chev" s={14} className="mt-1 shrink-0 text-on-surf-v transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="break-all font-bold tabular-nums text-on-surf">{journey.trip_reference}</h4>
              <Chip type={status.chipType} label={status.label} className={WRAPPING_CHIP} />
              <span className="text-xs text-on-surf-v">{journey.origin_name ?? 'Pickup unknown'} → {journey.destination_name ?? 'Delivery unknown'}</span>
              {journey.membership_source === 'creation_manifest' && <span className="text-xs text-on-surf-v">Planned manifest only</span>}
            </span>
          </summary>
          <div className="mt-2 pl-[22px]"><ParcelTimeline journey={journey} returnTo={returnTo} headingLevel={ROW_TIMELINE_HEADING_LEVEL} /></div>
        </details>
      })}
    </div>
    {hasMore && <div className="pt-3"><Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>Load earlier journeys</Button></div>}
  </section>
}
