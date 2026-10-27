import type { ReactNode } from 'react'
import { fmtTime } from '@shared/lib/utils/datetime'
import { CLOCK_SOURCE_LABEL, type RecordedTime } from '@/lib/phase/act-wording'
import { Ic, type IconName } from '@/components/ui/Ic'

interface Props {
  times: readonly RecordedTime[]
  icon: IconName
  iconClassName?: string
  connectToNext?: boolean
  children: ReactNode
}

export const COMPACT_COLUMNS = 'grid grid-cols-[max-content_1rem_minmax(0,1fr)] gap-x-2'
export const COMPACT_SUBGRID = 'col-span-full grid grid-cols-subgrid'
export const COMPACT_HIT_AREA = "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
const ROW = `${COMPACT_SUBGRID} min-h-8 items-start py-2 text-meta`

export function CompactActLine({ times, icon, iconClassName = 'text-on-surf-v', connectToNext = false, children }: Props) {
  return <span className={ROW} data-compact-act>
    <span className="min-w-0 text-on-surf-v" data-compact-time>
      {times.map(time => <span key={`${time.source}:${time.at}`} className="flex items-baseline gap-x-2 whitespace-nowrap">
        {time.at === null ? <span>Time unavailable</span> : <time dateTime={time.at} className="font-semibold tabular-nums tracking-[0.03em]">{fmtTime(time.at)}</time>}
        {time.source && <span className="text-label">{CLOCK_SOURCE_LABEL[time.source]}</span>}
      </span>)}
    </span>
    <span className="-mb-2 flex flex-col items-center self-stretch" data-compact-icon>
      <span className={`mt-0.5 flex ${iconClassName}`}><Ic n={icon} s={13} /></span>
      {connectToNext && <span aria-hidden="true" data-compact-connector className="pointer-events-none -mb-2 mt-0.5 w-px flex-1 bg-outline-v" />}
    </span>
    <span className="min-w-0 text-on-surf" data-compact-detail>{children}</span>
  </span>
}
