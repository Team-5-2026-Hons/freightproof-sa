import type { ReactNode } from 'react'
import { fmtTime } from '@shared/lib/utils/datetime'
import { CLOCK_SOURCE_LABEL, type RecordedTime } from '@/lib/phase/act-wording'
import { Ic, type IconName } from '@/components/ui/Ic'

interface Props {
  times: readonly RecordedTime[]
  icon: IconName
  iconClassName?: string
  children: ReactNode
}

// All compact records share these columns, including buttons and untimed evidence. The time
// column holds the time and its clock label on one line, so a record is one line tall.
// The icon starts 10px below the row top and is 13px high. Connect from its
// bottom to the next icon, centred after the 12rem time column and 0.5rem gap.
export const COMPACT_CONNECTOR = 'pointer-events-none absolute left-[calc(12.5rem+6px)] top-[23px] bottom-[-10px] w-px bg-outline-v'
const GRID = 'grid grid-cols-[12rem_1rem_minmax(0,1fr)] items-start gap-x-2 py-2 text-meta'

export function CompactActLine({ times, icon, iconClassName = 'text-on-surf-v', children }: Props) {
  return <span className={GRID} data-compact-act>
    <span className="min-w-0 text-on-surf-v" data-compact-time>
      {times.map(time => <span key={`${time.source}:${time.at}`} className="flex items-baseline gap-x-2 whitespace-nowrap">
        {time.at === null ? <span>Time unavailable</span> : <time dateTime={time.at} className="font-semibold tabular-nums tracking-[0.03em]">{fmtTime(time.at)}</time>}
        {time.source && <span className="text-label">{CLOCK_SOURCE_LABEL[time.source]}</span>}
      </span>)}
    </span>
    <span className={`mt-0.5 ${iconClassName}`} data-compact-icon><Ic n={icon} s={13} /></span>
    <span className="min-w-0 text-on-surf" data-compact-detail>{children}</span>
  </span>
}
