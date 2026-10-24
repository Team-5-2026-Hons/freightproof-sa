import { fmtSastDateParts, fmtSastDateTime } from '@shared/lib/utils/datetime'
import { Ic } from '@/components/ui/Ic'
import { describeUpdate, describeUpdateRun } from '@/lib/format/incident'
import { groupUpdates } from '@/lib/incidents/timeline-groups'
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
  const barcodeOf = (u: IncidentUpdate): string | undefined => (u.parcel_id ? parcels.get(u.parcel_id) : undefined)
  return (
    <ol className="relative flex flex-col gap-4 border-l border-outline-v/40 pl-5" aria-label="Incident history">
      {groupUpdates(incident.updates).map(row => row.type === 'run' ? (
        <li key={row.updates[0]!.update_id} className="relative">
          <span aria-hidden className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-outline" />
          <FoldedRun kind={row.kind} updates={row.updates} barcodeOf={barcodeOf} />
        </li>
      ) : (
        <li key={row.update.update_id} className="relative">
          <span aria-hidden className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-outline" />
          <p className="text-sm font-semibold text-on-surf">
            {describeUpdate(row.update, names)}
            {barcodeOf(row.update) && <span className="ml-1 font-normal tabular-nums text-on-surf-v">· {barcodeOf(row.update)}</span>}
          </p>
          {row.update.note && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-on-surf">{row.update.note}</p>}
          <p className="mt-1 text-xs tabular-nums text-on-surf-v">
            {row.update.recorded_by_name ?? 'Unknown dispatcher'} · {fmtSastDateTime(row.update.recorded_at) ?? '—'}
            {row.update.action_at && <> · happened {fmtSastDateTime(row.update.action_at)}</>}
          </p>
          {row.update.artifact_id && onOpenDocument && <DocumentButton artifactId={row.update.artifact_id} onOpen={onOpenDocument} />}
        </li>
      ))}
    </ol>
  )
}

/** "20 Oct 2026, 12:00 SAST – 12:09 SAST": the day is repeated only when the run crosses midnight. */
function timeSpan(first: string, last: string): string {
  const from = fmtSastDateParts(first)
  const to = fmtSastDateParts(last)
  if (!from || !to) return '—'
  return `${from.day}, ${from.time} – ${to.day === from.day ? to.time : `${to.day}, ${to.time}`}`
}

/** Three or more identical entries by one person as a single row. It is a native disclosure, so
 *  keyboard and screen readers work as they do for the Info panel's sections; opening it lists
 *  every entry, so nothing in the ledger is lost by folding. */
function FoldedRun({ kind, updates, barcodeOf }: { kind: IncidentUpdate['kind']; updates: IncidentUpdate[]; barcodeOf: (u: IncidentUpdate) => string | undefined }): React.JSX.Element {
  const first = updates[0]!
  const last = updates[updates.length - 1]!
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-on-surf">{describeUpdateRun(kind, updates.length)}</span>
          <span className="mt-1 block text-xs tabular-nums text-on-surf-v">
            {first.recorded_by_name ?? 'Unknown dispatcher'} · {timeSpan(first.recorded_at, last.recorded_at)}
          </span>
        </span>
        <Ic n="chev" s={14} className="mt-0.5 shrink-0 text-on-surf-v transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {updates.map(u => (
          <li key={u.update_id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-on-surf-v">
            <span className="font-semibold tabular-nums text-on-surf">{barcodeOf(u) ?? describeUpdate(u)}</span>
            <span className="tabular-nums">{fmtSastDateTime(u.recorded_at) ?? '—'}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function DocumentButton({ artifactId, onOpen }: { artifactId: string; onOpen: (artifactId: string) => void }): React.JSX.Element {
  return (
    <button type="button" onClick={() => onOpen(artifactId)} className="mt-1 text-xs font-semibold text-sec hover:underline">
      Open document
    </button>
  )
}
