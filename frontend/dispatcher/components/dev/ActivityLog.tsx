import { fmtExceptionType } from '@/lib/format/exception'
import type { ActivityEntry } from '@/lib/hooks/useDevTriggers'
import { fmtTime } from '@shared/lib/utils/datetime'

interface ActivityLogProps {
  entries: readonly ActivityEntry[]
}

/** What the presenter did and what the system recorded, newest first. */
export function ActivityLog({ entries }: ActivityLogProps): React.ReactElement {
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">Nothing yet. Every action you take is listed here.</p>
  }
  return (
    <ul aria-label="Activity" className="space-y-1">
      {entries.map(entry => (
        <li key={entry.id} className={`text-sm ${entry.tone === 'error' ? 'text-red-600' : 'text-on-surf'}`}>
          <span className="mr-2 tabular-nums text-xs text-slate-500">{fmtTime(entry.at)}</span>
          {entry.text}
          {entry.findings.map(f => (
            <span key={`${f.exception_type}-${f.vehicle_id}`} className="ml-2 text-xs font-semibold text-amber-700">
              → {fmtExceptionType(f.exception_type)} ({f.severity})
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}
