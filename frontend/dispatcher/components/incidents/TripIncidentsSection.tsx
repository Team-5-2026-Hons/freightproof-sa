import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
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
  /** The incident the timeline just pointed at: outlined for a moment so the eye finds it in the list. */
  highlightedId?: string | null
}

/** The attribute the page's landing looks the row up by. */
export const INCIDENT_ROW_ATTR = 'data-incident-row'

/** A trip's incidents and the way to report one: the body of the Info tab's Incidents section,
 *  which supplies the heading. Its own section because an incident outlives the trip: a closed
 *  trip can still have an open shortage investigation. */
export function TripIncidentsSection({ incidents, isLoading, returnTo, onReport, highlightedId = null }: Props): React.JSX.Element {
  const report = <Button size="sm" variant="secondary" onClick={onReport}>Report incident</Button>
  if (isLoading && incidents.length === 0) return <SectionRowsSkeleton rows={2} label="Loading incidents" />
  // Nothing to list: the sentence and the one thing to do about it share a line.
  if (incidents.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-on-surf-v">No incidents on this trip.</p>
        {report}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {incidents.map(i => (
          <li key={i.incident_id} {...{ [INCIDENT_ROW_ATTR]: i.incident_id }} tabIndex={-1}
            className={`flex items-start justify-between gap-3 rounded-lg border border-outline-v/40 bg-surf-lowest p-3 focus-visible:outline-none ${i.incident_id === highlightedId ? 'ring-2 ring-sec' : ''}`}>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-on-surf">{i.reference} · {INCIDENT_TYPE_LABELS[i.incident_type]}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-on-surf">{i.summary}</span>
              {facts(i) && <span className="mt-0.5 block text-xs text-on-surf-v">{facts(i)}</span>}
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <IncidentStatusChip status={i.status} />
                {i.trip_stopped_at && <Chip type="critical" label="Trip stopped" />}
              </span>
            </span>
            <RecordLink href={withReturnTo(ROUTES.incidentDetail(i.incident_id), returnTo)} className="shrink-0 pt-0.5 text-xs">
              View incident<span className="sr-only"> {i.reference}</span>
            </RecordLink>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">{report}</div>
    </div>
  )
}

/** The one line under the title: what is still open. Whether this incident ended the trip is a chip in the row below it. */
function facts(incident: IncidentSummary): string {
  return incident.parcels_total > 0 ? unresolvedLabel(incident) : ""
}

/** "2 of 7 parcels unresolved": the count alone does not say what it is a count of. */
function unresolvedLabel(incident: IncidentSummary): string {
  return `${incident.parcels_unresolved} of ${incident.parcels_total} ${incident.parcels_total === 1 ? 'parcel' : 'parcels'} unresolved`
}
