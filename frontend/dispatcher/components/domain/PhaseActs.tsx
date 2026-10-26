'use client'

import { Fragment, type ReactNode } from 'react'

import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import { groupActs, isUntimedSubmittedEvidence, type ActItem } from '@/lib/phase/act-groups'
import type { PhaseAct } from '@/lib/phase/acts'
import { useRecentKeys } from '@/lib/hooks/useRecentKeys'
import { ExceptionMoreRow, type OpenException } from './ExceptionRow'
import type { EvidenceLookup } from './EvidenceGroupRow'
import { ActRow, RailRow, type ActRowContext } from './PhaseActRow'
import type { TripEventHandlers } from './TripEventRow'
import { COMPACT_COLUMNS, COMPACT_SUBGRID } from './CompactActLine'
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
  /** In Transit only: where an incident or a driver transfer row leads. */
  tripEvents?: TripEventHandlers
  density?: 'compact' | 'full'
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
  const { acts, phase, visibleExceptionIds, hiddenExceptionCount, live, density = 'full' } = props
  const compact = density === 'compact'
  const grouped = groupActs(acts).filter(item => !compact || item.kind !== 'anchor')
  const shown = grouped.filter(item => !isHiddenException(item, visibleExceptionIds))
  const recent = useRecentKeys(grouped.flatMap(highlightKeysOf), live && !compact)
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
    tripEvents: props.tripEvents,
  }
  const moreAfter = hiddenExceptionCount > 0 ? lastVisibleExceptionIndex(shown) : -1

  if (shown.length === 0) return null
  // Items that belong to the confirmation rather than to a point on the chronology: findings the
  // confirmation raised, and evidence submitted with it that carries no capture time. They are
  // drawn under the completion, so they only leave the chronology when a completion exists.
  const attached = shown.filter(item => item.kind === 'exception' && item.trigger !== 'event')
  const untimed = shown.filter(isUntimedSubmittedEvidence)
  const hasCompletion = shown.some(item => item.kind === 'completion')
  const underCompletion = new Set<ActItem>(hasCompletion ? [...attached, ...untimed] : [])
  const chronology = shown.filter(item => !underCompletion.has(item))
  // The "+n more" row follows the last visible exception.
  const moreItem = moreAfter >= 0 ? shown[moreAfter] : null

  /** Whether the rail continues from this row into the next one. */
  function connectsToNext(item: ActItem, nested: boolean): boolean {
    const hasMore = item === moreItem
    if (nested) {
      const index = attached.indexOf(item)
      return index >= 0 && (index < attached.length - 1 || hasMore)
    }
    // A group heading interrupts the rail, so the confirmation does not connect into its groups.
    if (item.kind === 'completion' && underCompletion.size > 0) return false
    return chronology.indexOf(item) < chronology.length - 1 || hasMore
  }

  function entry(item: ActItem, nested = false): ReactNode {
    return <ActEntry key={item.key} item={item} context={context} density={density} nested={nested} connectToNext={connectsToNext(item, nested)}
      highlighted={highlightKeysOf(item).some(key => recent.has(key))}
      more={item === moreItem ? { hiddenCount: hiddenExceptionCount, phaseId: phase.phase_event_id, onOpen: props.onOpenException } : null} />
  }

  // Compact, the list owns the time, icon and detail columns that every row joins (R3).
  const rows = <ol className={compact ? COMPACT_COLUMNS : undefined}>
    {chronology.map(item => (
      <Fragment key={item.key}>
        {entry(item)}
        {item.kind === 'completion' && <>
          {attached.length > 0 && <ConfirmationGroup compact={compact} title={item.outcome === 'overridden' ? 'Recorded with this override' : 'Findings from this confirmation'}>
            {attached.map(finding => entry(finding, true))}
          </ConfirmationGroup>}
          {untimed.length > 0 && <ConfirmationGroup compact={compact} title="Submitted evidence · capture time unavailable">
            {untimed.map(evidence => entry(evidence, true))}
          </ConfirmationGroup>}
        </>}
      </Fragment>
    ))}
  </ol>
  return compact ? <div className="mt-2">{rows}</div> : <PhaseZone title="Recorded">{rows}</PhaseZone>
}

interface ConfirmationGroupProps { title: string; compact: boolean; children: ReactNode }

/** A group that belongs to the confirmation, not to a later instant on the chronology. Its
 * heading is flush left, in full-strength text, so it reads as a label for the rows under it
 * rather than as one more row; the rail breaks at the heading. */
function ConfirmationGroup({ title, compact, children }: ConfirmationGroupProps) {
  // Compact, the group passes the card's columns through, so its rows align with the rest.
  return <li role="group" aria-label={title} className={`pb-1 ${compact ? COMPACT_SUBGRID : ''}`}>
    <p className={`pb-1 pt-2 text-meta font-semibold text-on-surf ${compact ? 'col-span-full' : ''}`}>{title}</p>
    <ol className={compact ? COMPACT_SUBGRID : undefined}>{children}</ol>
  </li>
}

interface EntryProps {
  item: ActItem
  context: ActRowContext
  highlighted: boolean
  more: { hiddenCount: number; phaseId: string; onOpen: OpenException } | null
  density: 'compact' | 'full'
  nested: boolean
  connectToNext: boolean
}

/** One item, plus the "+n more" row when this is the last visible exception. */
function ActEntry({ item, context, highlighted, more, density, nested, connectToNext }: EntryProps) {
  return (
    <>
      <ActRow item={item} context={context} highlighted={highlighted} density={density} nested={nested} connectToNext={connectToNext} />
      {more && (density === 'compact'
        ? <li className={COMPACT_SUBGRID}><ExceptionMoreRow hiddenCount={more.hiddenCount} phaseId={more.phaseId} onOpen={more.onOpen} density={density} /></li>
        : <RailRow kind="more" highlighted={false}><ExceptionMoreRow hiddenCount={more.hiddenCount} phaseId={more.phaseId} onOpen={more.onOpen} /></RailRow>)}
    </>
  )
}
