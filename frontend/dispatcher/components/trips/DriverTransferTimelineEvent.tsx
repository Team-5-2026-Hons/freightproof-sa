'use client'

import { ArrowRightLeft } from 'lucide-react'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import { fmtDateTime } from '@shared/lib/utils/datetime'

interface Props {
  event: CompletedSubstitutionSummary
  onOpen: (id: string) => void
  sameRecordedTime?: boolean
}

export function DriverTransferTimelineEvent({ event, onOpen, sameRecordedTime = false }: Props): React.JSX.Element {
  return <article aria-label="Completed driver transfer" className="relative flex min-w-0 gap-[14px]" data-transfer-id={event.substitution_id}>
    <div className="flex w-[30px] shrink-0 flex-col items-center" aria-hidden>
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-outline-v text-on-surf-v"><ArrowRightLeft size={14} /></span>
      <span className="my-1 min-h-5 w-0.5 flex-1 bg-outline-v/30" />
    </div>
    <button type="button" onClick={() => onOpen(event.substitution_id)} aria-haspopup="dialog"
      aria-label={`Driver transferred — ${event.outgoing.full_name} → ${event.incoming.full_name}`}
      className="mb-3 min-w-0 flex-1 rounded-lg border border-outline-v/40 bg-surf-lowest px-4 py-3 text-left hover:bg-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">
      <span className="block text-sm font-bold text-on-surf">Driver transferred</span>
      <span className="block text-[13px] text-on-surf">{event.outgoing.full_name} → {event.incoming.full_name}</span>
      <time dateTime={event.effective_at} className="block text-xs text-on-surf-v">Effective {fmtDateTime(event.effective_at)}</time>
      <span className="block text-xs text-on-surf-v">{event.completion_mode?.replaceAll('_', ' ') ?? 'Completion mode not recorded'} · Anchor: {event.anchor_status ?? 'not recorded'}</span>
      {sameRecordedTime && <span className="block text-xs text-on-surf-v">Same recorded time</span>}
    </button>
  </article>
}
