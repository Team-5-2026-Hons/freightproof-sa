import { Chip } from '@/components/ui/Chip'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { CONFIDENCE_LABELS, OUTCOME_LABELS } from '@/lib/format/incident'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentStatusChip } from './IncidentStatusChip'

interface Props {
  incident: IncidentSummary
}

/**
 * Three questions that must never be merged into one badge: is the trip still running, have
 * the alerts been assessed, and is the investigation finished. A trip can close while a
 * shortage investigation stays open, and a reviewed alert says nothing about the outcome.
 */
export function IncidentStatusStrip({ incident }: Props): React.JSX.Element {
  const trip = TRIP_STATUS_META[incident.trip_status]
  const reviewed = `${incident.exceptions_reviewed} of ${incident.exceptions_total} reviewed`
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Incident state">
      <div className="rounded-md bg-surf-low px-4 py-3">
        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-on-surf-v">Trip</dt>
        <dd className="mt-1 flex flex-wrap items-center gap-2">
          <Chip type={trip.chipType} label={trip.label} />
          {incident.trip_stopped_at && <span className="text-xs text-on-surf-v">Stopped by this incident</span>}
        </dd>
      </div>
      <div className="rounded-md bg-surf-low px-4 py-3">
        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-on-surf-v">Exceptions</dt>
        <dd className="mt-1 text-sm font-semibold text-on-surf">{incident.exceptions_total === 0 ? 'None grouped' : reviewed}</dd>
      </div>
      <div className="rounded-md bg-surf-low px-4 py-3">
        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-on-surf-v">Incident</dt>
        <dd className="mt-1 flex flex-wrap items-center gap-2">
          <IncidentStatusChip status={incident.status} />
          <span className="text-xs text-on-surf-v">{incident.outcome ? OUTCOME_LABELS[incident.outcome] : CONFIDENCE_LABELS[incident.confidence]}</span>
        </dd>
      </div>
    </dl>
  )
}
