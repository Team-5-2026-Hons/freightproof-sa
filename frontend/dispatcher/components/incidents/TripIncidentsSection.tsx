import { Button } from '@/components/ui/Button'
import { RecordLink } from '@/components/ui/RecordLink'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { SectionRowsSkeleton } from './IncidentSkeletons'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentStatusChip } from './IncidentStatusChip'

interface Props {
  incidents: IncidentSummary[]
  isLoading: boolean
  /** This trip's own URL, so an incident opened from here comes back here. */
  returnTo: string
  onReport: () => void
}

/** A trip's incidents and the way to report one, on its Info tab. Its own section because an
 *  incident outlives the trip: a closed trip can still have an open shortage investigation. */
export function TripIncidentsSection({ incidents, isLoading, returnTo, onReport }: Props): React.JSX.Element {
  return (
    <section aria-labelledby="trip-incidents-heading" className="border-t border-outline-v/30 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="trip-incidents-heading" className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">Incidents</h3>
        <Button size="sm" variant="secondary" onClick={onReport}>Report incident</Button>
      </div>
      {isLoading && incidents.length === 0 ? <div className="mt-3"><SectionRowsSkeleton rows={2} label="Loading incidents" /></div>
        : incidents.length === 0 ? <p className="mt-3 text-sm text-on-surf-v">No incidents on this trip.</p>
          : <ul className="mt-3 flex flex-col gap-2">
            {incidents.map(i => (
              <li key={i.incident_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surf-low px-3 py-2">
                <RecordLink href={withReturnTo(ROUTES.incidentDetail(i.incident_id), returnTo)} className="text-sm">
                  {i.reference} · {INCIDENT_TYPE_LABELS[i.incident_type]}
                </RecordLink>
                <span className="flex items-center gap-2 text-xs text-on-surf-v">
                  {i.parcels_unresolved > 0 && <span>{i.parcels_unresolved} unresolved</span>}
                  <IncidentStatusChip status={i.status} />
                </span>
              </li>
            ))}
          </ul>}
    </section>
  )
}
