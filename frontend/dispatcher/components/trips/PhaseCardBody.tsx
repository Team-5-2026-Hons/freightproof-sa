'use client'

import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { Trip } from '@shared/lib/types/trip'
import { PhaseActs, type PhaseActsProps } from '@/components/domain/PhaseActs'
import { PhaseAudit } from '@/components/domain/PhaseAudit'
import { PhaseChecks } from '@/components/domain/PhaseChecks'
import { PhaseOverrideAction } from '@/components/domain/PhaseOverrideAction'
import type { PhaseCardModel } from '@/lib/phase/card'
import { useObservedWidth } from '@/lib/hooks/useObservedWidth'
import { isResolved } from '@/lib/phase/derive'
import { chooseBodyLayout, realCheckCount } from '@/lib/phase/layout'
import { precinctAtPhase } from '@/lib/phase/trip-detail'

/** What the Recorded zone needs beyond the model: names, the artifact lookup and the exception
 *  row plumbing. */
export type RecordedProps = Omit<PhaseActsProps, 'acts' | 'phase' | 'live'>

interface Props {
  trip: Trip
  phase: PhaseDescriptor
  model: PhaseCardModel
  precincts: Precinct[]
  receipt: BlockchainReceipt | undefined
  recorded: RecordedProps
  slotTime: string | null
  onChanged: () => void
}

const SPLIT_GRID = 'grid grid-cols-[1.15fr_1fr] gap-x-6'
const SPLIT_CHECKED = 'border-l border-outline-v/30 pl-6'

/**
 * An opened phase card: Recorded and Checked, then (forensic mode only) Audit trail, with the
 * dispatcher's override action below. Recorded and Checked sit side by side when the card body
 * measures at least SPLIT_MIN_PX, the phase has a check and it is not in_transit (D30); stacked
 * otherwise, which is the layout that holds from 564 px up. Audit trail is always below both.
 */
export function PhaseCardBody({ trip, phase, model, precincts, receipt, recorded, slotTime, onChanged }: Props) {
  const { ref, width } = useObservedWidth<HTMLDivElement>()
  const layout = chooseBodyLayout({
    widthPx: width,
    checkCount: model.checkedZone === 'none' ? 0 : realCheckCount(model.checks),
    phaseType: phase.phase_type,
  })
  const split = layout === 'split'
  return (
    <div ref={ref} data-layout={layout} className="mt-3 space-y-4 border-t border-outline-v/20 pt-3">
      <div className={split ? SPLIT_GRID : 'space-y-4'}>
        <PhaseActs {...recorded} acts={model.acts} phase={phase} live={model.isActive && model.running} />
        {model.checkedZone !== 'none' && (
          <div className={split ? SPLIT_CHECKED : undefined}>
            <PhaseChecks phase={phase} checks={model.checks} zone={model.checkedZone} precinct={precinctAtPhase(trip, phase, precincts)} slotTime={slotTime} />
          </div>
        )}
      </div>
      {isResolved(phase) && <PhaseAudit phase={phase} receipt={receipt} />}
      <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={onChanged} />
    </div>
  )
}
