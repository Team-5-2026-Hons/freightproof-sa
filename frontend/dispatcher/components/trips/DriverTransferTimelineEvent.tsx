'use client'

import { useId } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { fmtTransferOutcome } from '@/lib/format/driver-transfer'
import { PhaseClock } from './PhaseTimelineItem'

interface Props {
  event: CompletedSubstitutionSummary
  onOpen: (id: string) => void
  sameRecordedTime?: boolean
}

export function DriverTransferTimelineEvent({ event, onOpen, sameRecordedTime = false }: Props): React.JSX.Element {
  const outcomeId = useId()
  return <article aria-label="Completed driver transfer" className="relative flex min-w-0 gap-[14px]" data-transfer-id={event.substitution_id}>
    <div className="flex w-[30px] shrink-0 flex-col items-center" aria-hidden>
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-outline-v text-on-surf-v"><ArrowRightLeft size={14} /></span>
      <span className="my-1 min-h-5 w-0.5 flex-1 bg-outline-v/30" />
    </div>
    <button type="button" onClick={() => onOpen(event.substitution_id)} aria-haspopup="dialog"
      aria-label={`Driver transferred — ${event.outgoing.full_name} → ${event.incoming.full_name}`}
      // The label replaces the card's text for assistive tech, so how it was completed and sealed is its description.
      aria-describedby={outcomeId}
      className="mb-3 min-w-0 flex-1 rounded-lg border border-outline-v/40 bg-surf-lowest px-4 py-3 text-left hover:bg-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm font-bold text-on-surf">Driver transferred</span>
        <PhaseClock timestamp={event.effective_at} label={`Effective ${fmtDateTime(event.effective_at)}`} />
      </span>
      <span className="block text-[13px] text-on-surf">{event.outgoing.full_name} → {event.incoming.full_name}</span>
      <span id={outcomeId} className="block text-xs text-on-surf-v">{fmtTransferOutcome(event.completion_mode, event.anchor_status, event.request_format)}</span>
      {sameRecordedTime && <span className="block text-xs text-on-surf-v">Same recorded time</span>}
    </button>
  </article>
}
