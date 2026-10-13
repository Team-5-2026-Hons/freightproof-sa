'use client'

import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import { groupActs, type ActItem } from '@/lib/phase/act-groups'
import type { PhaseAct } from '@/lib/phase/acts'
import { useRecentKeys } from '@/lib/hooks/useRecentKeys'
import { ExceptionMoreRow, type OpenException } from './ExceptionRow'
import type { EvidenceLookup } from './EvidenceGroupRow'
import { ActRow, RailRow, type ActRowContext } from './PhaseActRow'
import { PhaseZone } from './PhaseZone'

export type { EvidenceLookup } from './EvidenceGroupRow'

export interface PhaseActsProps {
  acts: readonly PhaseAct[]
  phase: PhaseDescriptor
  /** The stop this phase is anchored to (for in_transit, the one it departs from). */
  stopName: string
  destinationName: string
  expectedArrivalAt: string | null
  lookup: EvidenceLookup
  exceptionsById: ReadonlyMap<string, TripException>
  /** The exception rows within the card's cap (D33); the rest are behind "+n more". */
  visibleExceptionIds: ReadonlySet<string>
  hiddenExceptionCount: number
  /** The phase is the live one of a running trip: only then does a new row draw the eye. */
  live: boolean
  selectedExceptionId: string | null
  highlightedExceptionId: string | null
  onOpenException: OpenException
}

/** The keys a row can be identified by, for the "new while live" highlight. Expectations and
 *  the anchor are not records, so they never count as new. */
function highlightKeysOf(item: ActItem): string[] {
  if (item.kind === 'evidence_group') return item.acts.map(act => act.key)
  return item.kind === 'expected' || item.kind === 'anchor' ? [] : [item.key]
}

function isHiddenException(item: ActItem, visible: ReadonlySet<string>): boolean {
  return item.kind === 'exception' && !visible.has(item.exceptionId)
}

/** Index of the last exception row that stays visible: the "+n more" row follows it. */
function lastVisibleExceptionIndex(items: readonly ActItem[]): number {
  return items.reduce((last, item, index) => (item.kind === 'exception' ? index : last), -1)
}

/**
 * The "Recorded" zone: what happened in this phase, in order, as a rail of rows. Evidence goes
 * through EvidencePhoto and EvidenceDocument so their honest states ("Recorded artifact
 * unavailable", "Evidence lookup failed") come from one place. Exception rows open the
 * exceptions panel; the full card is never drawn here (D33).
 */
export function PhaseActs(props: PhaseActsProps) {
  const { acts, phase, visibleExceptionIds, hiddenExceptionCount, live } = props
  const grouped = groupActs(acts)
  const shown = grouped.filter(item => !isHiddenException(item, visibleExceptionIds))
  const recent = useRecentKeys(grouped.flatMap(highlightKeysOf), live)
  const context: ActRowContext = {
    phase,
    stopName: props.stopName,
    destinationName: props.destinationName,
    expectedArrivalAt: props.expectedArrivalAt,
    lookup: props.lookup,
    exceptionsById: props.exceptionsById,
    selectedExceptionId: props.selectedExceptionId,
    highlightedExceptionId: props.highlightedExceptionId,
    onOpenException: props.onOpenException,
  }
  const moreAfter = hiddenExceptionCount > 0 ? lastVisibleExceptionIndex(shown) : -1

  if (shown.length === 0) return null
  return (
    <PhaseZone title="Recorded">
      <ol>
        {shown.map((item, index) => (
          <ActEntry
            key={item.key}
            item={item}
            context={context}
            highlighted={highlightKeysOf(item).some(key => recent.has(key))}
            more={index === moreAfter ? { hiddenCount: hiddenExceptionCount, phaseId: phase.phase_event_id, onOpen: props.onOpenException } : null}
          />
        ))}
      </ol>
    </PhaseZone>
  )
}

interface EntryProps {
  item: ActItem
  context: ActRowContext
  highlighted: boolean
  more: { hiddenCount: number; phaseId: string; onOpen: OpenException } | null
}

/** One item, plus the "+n more" row when this is the last visible exception. */
function ActEntry({ item, context, highlighted, more }: EntryProps) {
  return (
    <>
      <ActRow item={item} context={context} highlighted={highlighted} />
      {more && (
        <RailRow kind="more" highlighted={false}>
          <ExceptionMoreRow hiddenCount={more.hiddenCount} phaseId={more.phaseId} onOpen={more.onOpen} />
        </RailRow>
      )}
    </>
  )
}
