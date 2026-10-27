'use client'

import { fmtDateTime } from '@shared/lib/utils/datetime'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { PhaseClock } from '@/components/trips/PhaseTimelineItem'
import { INCIDENT_TYPE_LABELS } from '@/lib/format/incident'
import { incidentEventTime } from '@/lib/phase/trip-events'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentStatusChip } from './IncidentStatusChip'
import { EXCEPTION_SELECTED_SURFACE, EXCEPTION_SELECTION_OUTLINE } from '@/components/domain/ExceptionRow'

interface Props {
  incident: IncidentSummary
  /** The card was activated. The page answers by showing the incident in the Info panel, so the reader
   *  stays on the trip; the incident's own page is one click further, from there. */
  onOpen: (incidentId: string) => void
  selected?: boolean
}

const LIVE_NODE = 'bg-err text-err-on'
const CLOSED_NODE = 'border border-outline-v text-on-surf-v'
const LIVE_CARD = 'border border-err/40 bg-err-c/40 hover:bg-err-c/60'
const CLOSED_CARD = 'border border-outline-v/40 bg-surf-lowest hover:bg-surf'
const SELECTED_CARD = `${EXCEPTION_SELECTED_SURFACE} ${EXCEPTION_SELECTION_OUTLINE}`

/** An incident drawn between phase cards like a driver transfer, but louder while it is live: a filled siren
 *  node and a red-tinted card, because it is the one record on the rail that someone is still working. */
export function IncidentTimelineEvent({ incident, onOpen, selected = false }: Props): React.JSX.Element {
  const title = `${incident.reference} · ${INCIDENT_TYPE_LABELS[incident.incident_type]}`
  const at = incidentEventTime(incident)
  const closed = incident.status === 'closed'
  const details = [
    incident.parcels_total > 0 ? `${incident.parcels_unresolved} of ${incident.parcels_total} ${incident.parcels_total === 1 ? 'parcel' : 'parcels'} unresolved` : null,
    incident.assigned_to_name,
  ].filter(Boolean).join(' · ')
  return <article aria-label="Incident" className="relative flex min-w-0 gap-[14px]" data-incident-id={incident.incident_id}>
    <div className="flex w-[30px] shrink-0 flex-col items-center" aria-hidden>
      <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-full ${closed ? CLOSED_NODE : LIVE_NODE}`}><Ic n="siren" s={15} /></span>
      <span className="my-1 min-h-5 w-0.5 flex-1 bg-outline-v/30" />
    </div>
    <button type="button" onClick={() => onOpen(incident.incident_id)}
      aria-label={`Incident ${title}`} aria-current={selected ? 'true' : undefined} data-selected={selected ? 'true' : undefined}
      className={`mb-3 flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec ${selected ? `border ${closed ? 'border-outline-v/40' : 'border-err/40'} ${SELECTED_CARD}` : closed ? CLOSED_CARD : LIVE_CARD}`}>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-bold ${closed ? 'text-on-surf' : 'text-err-onc'}`}>{title}</span>
          <IncidentStatusChip status={incident.status} />
          {incident.trip_stopped_at && <Chip type="critical" label={`Trip stopped ${fmtDateTime(incident.trip_stopped_at)}`} />}
        </span>
        <PhaseClock timestamp={at} label={`Reported ${fmtDateTime(at)}`} />
      </span>
      <span className="line-clamp-2 text-[13px] text-on-surf">{incident.summary}</span>
      {details && <span className="text-xs text-on-surf-v">{details}</span>}
    </button>
  </article>
}
