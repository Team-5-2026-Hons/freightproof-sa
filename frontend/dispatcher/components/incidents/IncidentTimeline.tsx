import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import { describeUpdate } from '@/lib/format/incident'
import type { IncidentDetail, IncidentUpdate } from '@/lib/types/incident'

interface Props {
  incident: IncidentDetail
  /** Opens a document the ledger cites. */
  onOpenDocument?: (artifactId: string) => void
}

/** Ids of everyone named on the ledger, so an assignment can show a name, not a UUID. */
function namesOf(updates: readonly IncidentUpdate[], incident: IncidentDetail): Map<string, string> {
  const names = new Map<string, string>()
  for (const u of updates) if (u.recorded_by_name) names.set(u.recorded_by_user_id, u.recorded_by_name)
  if (incident.assigned_to_user_id && incident.assigned_to_name) names.set(incident.assigned_to_user_id, incident.assigned_to_name)
  return names
}

/**
 * The incident's append-only ledger, oldest first. There is no edit or delete control on any
 * entry: a correction is a later entry, so the first assessment and everything learned since
 * stay side by side.
 */
export function IncidentTimeline({ incident, onOpenDocument }: Props): React.JSX.Element {
  const names = namesOf(incident.updates, incident)
  const parcels = new Map(incident.parcels.map(p => [p.parcel_id, p.barcode]))
  return (
    <ol className="relative flex flex-col gap-4 border-l border-outline-v/40 pl-5" aria-label="Incident history">
      {incident.updates.map(u => (
        <li key={u.update_id} className="relative">
          <span aria-hidden className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-outline" />
          <p className="text-sm font-semibold text-on-surf">
            {describeUpdate(u, names)}
            {u.parcel_id && parcels.has(u.parcel_id) && <span className="ml-1 font-normal tabular-nums text-on-surf-v">· {parcels.get(u.parcel_id)}</span>}
          </p>
          {u.note && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-on-surf">{u.note}</p>}
          <p className="mt-1 text-xs tabular-nums text-on-surf-v">
            {u.recorded_by_name ?? 'Unknown dispatcher'} · {fmtSastDateTime(u.recorded_at) ?? '—'}
            {u.action_at && <> · happened {fmtSastDateTime(u.action_at)}</>}
          </p>
          {u.artifact_id && onOpenDocument && <DocumentButton artifactId={u.artifact_id} onOpen={onOpenDocument} />}
        </li>
      ))}
    </ol>
  )
}

function DocumentButton({ artifactId, onOpen }: { artifactId: string; onOpen: (artifactId: string) => void }): React.JSX.Element {
  return (
    <button type="button" onClick={() => onOpen(artifactId)} className="mt-1 text-xs font-semibold text-sec hover:underline">
      Open document
    </button>
  )
}
