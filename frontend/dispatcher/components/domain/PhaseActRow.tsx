'use client'

import type { ReactNode } from 'react'
import { Ic, type IconName } from '@/components/ui/Ic'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { EVIDENCE_ROLE_NOUN } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import {
  absentLabel, anchorLabel, completionTimeLine, completionTitle, completionValueLines, expectedLabel,
  evidenceStateLabel, evidenceTimes, completionTimes, evidenceTitle, SERVER_CLOCK, type RecordedTime,
} from '@/lib/phase/act-wording'
import { isDocumentRole, type AbsentAct, type AnchorAct, type CompletionAct, type ExpectedAct, type MilestoneAct } from '@/lib/phase/acts'
import type { ActItem } from '@/lib/phase/act-groups'
import { EvidenceGroupRow, type EvidenceLookup } from './EvidenceGroupRow'
import type { EvidenceGroup } from '@/lib/phase/act-groups'
import { NumericText } from './NumericText'
import { CompactActLine, COMPACT_SUBGRID } from './CompactActLine'
import { ExceptionRow, type OpenException } from './ExceptionRow'
import { TripEventRow, type TripEventHandlers } from './TripEventRow'

type RailKind = 'evidence' | 'milestone' | 'completion' | 'exception' | 'absent' | 'anchor' | 'expected' | 'more' | 'incident' | 'transfer'
type Tone = 'ok' | 'warn' | 'err' | 'neutral' | 'chain'

const KIND_ICON: Record<RailKind, IconName> = {
  evidence: 'cam', milestone: 'truck', completion: 'check', exception: 'warn', absent: 'cam', anchor: 'hex', expected: 'clock', more: 'plus',
  incident: 'siren', transfer: 'swap',
}
const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok', warn: 'text-warn', err: 'text-err', neutral: 'text-on-surf-v', chain: 'text-chain',
}
const KIND_TONE: Partial<Record<RailKind, Tone>> = { completion: 'ok', exception: 'warn', anchor: 'chain', incident: 'err' }

const HEADLINE = 'text-body font-semibold text-on-surf'
const DETAIL = 'text-body text-on-surf-v'
const TIME = 'text-meta font-semibold tabular-nums tracking-[0.03em] text-on-surf-v'
const HIGHLIGHT = 'bg-sec-c/60 motion-safe:transition-colors motion-safe:duration-700'

/** What a row needs from the card around it. Grouped so the row components stay at a few props. */
export interface ActRowContext {
  phase: PhaseDescriptor
  stopName: string
  destinationName: string
  expectedArrivalAt: string | null
  lookup: EvidenceLookup
  exceptionsById: ReadonlyMap<string, TripException>
  selectedExceptionId: string | null
  highlightedExceptionId: string | null
  onOpenException: OpenException
  tripEvents?: TripEventHandlers
}

const NO_TRIP_EVENT_HANDLERS: TripEventHandlers = { onOpenIncident: () => undefined, onOpenTransfer: () => undefined }

interface RailRowProps {
  kind: RailKind
  highlighted: boolean
  children: ReactNode
}

/** One entry on the rail: its icon, a connector to the next entry, and the body. An expectation
 *  is drawn dashed (D15): it is not a record. */
export function RailRow({ kind, highlighted, children }: RailRowProps) {
  const tone = KIND_TONE[kind] ?? 'neutral'
  const shell = kind === 'expected' ? 'border border-dashed border-outline' : 'bg-surf-high'
  return (
    <li data-row-kind={kind} data-highlighted={highlighted ? 'true' : undefined} className={`group flex gap-2.5 rounded-md ${highlighted ? HIGHLIGHT : ''}`}>
      <div className="flex shrink-0 flex-col items-center">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${shell} ${TONE_TEXT[tone]}`}>
          <Ic n={KIND_ICON[kind]} s={13} />
        </span>
        <span className="my-0.5 min-h-[10px] w-px flex-1 bg-outline-v group-last:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-3">{children}</div>
    </li>
  )
}

function MilestoneBody({ act, stopName }: { act: MilestoneAct; stopName: string }) {
  return (
    <div>
      <p className={HEADLINE}>Departed {stopName}</p>
      {act.sealNumber !== null && <p className={DETAIL}><NumericText text={`Sealed ${act.sealNumber} at departure`} /></p>}
      <p className={TIME}>Recorded {fmtDateTime(act.at)} {SERVER_CLOCK}</p>
    </div>
  )
}

function CompletionBody({ act, context }: { act: CompletionAct; context: ActRowContext }) {
  const { phase, stopName, destinationName } = context
  return (
    <div>
      <p className={HEADLINE}>{completionTitle(act, phase.phase_type, stopName, destinationName)}</p>
      {completionValueLines(act, phase.phase_type).map(line => <p key={line} className={DETAIL}><NumericText text={line} /></p>)}
      <p className={TIME}>{completionTimeLine(act)}</p>
    </div>
  )
}

function AnchorBody({ act }: { act: AnchorAct }) {
  return <p className={`${HEADLINE} ${act.status === 'anchored' ? 'text-chain' : ''}`}>{anchorLabel(act)}</p>
}

function ExpectedBody({ act, context }: { act: ExpectedAct; context: ActRowContext }) {
  const label = expectedLabel(act, context.phase.phase_type, context.destinationName, context.expectedArrivalAt)
  return <p className={`${DETAIL} italic`}>{label}</p>
}

function AbsentBody({ act }: { act: AbsentAct }) {
  return <p className={DETAIL}>{absentLabel(act)}</p>
}

interface ItemProps {
  item: ActItem
  context: ActRowContext
  highlighted: boolean
  density?: 'compact' | 'full'
  nested?: boolean
  connectToNext?: boolean
}

interface CompactRecord { times: RecordedTime[]; detail: string }

/** Keep clock and state/provenance even when images and the value grid are collapsed. */
function compactEvidence(group: EvidenceGroup, context: ActRowContext): CompactRecord {
  const titles = [...new Set(group.acts.map(act => evidenceTitle(act, context.phase.phase_type)))].join(' · ')
  const count = group.acts.length > 1 ? ` · ${group.acts.length} ${isDocumentRole(group.role) ? 'files' : 'photos'} uploaded` : ''
  const states = [...new Set(group.acts.map(evidenceStateLabel))].join(' · ')
  const times = new Map(group.acts.flatMap(act => evidenceTimes(act).map(time => [`${time.source}:${time.at}`, time] as const)))
  return { times: [...times.values()], detail: `${titles}${count} · ${states}` }
}

function compactRecord(item: Exclude<ActItem, { kind: 'exception' } | { kind: 'trip_event' }>, context: ActRowContext): CompactRecord | null {
  switch (item.kind) {
    case 'evidence_group': return compactEvidence(item, context)
    case 'completion': return {
      times: completionTimes(item),
      detail: [completionTitle(item, context.phase.phase_type, context.stopName, context.destinationName), ...completionValueLines({ ...item, override: null }, context.phase.phase_type)].join(' · '),
    }
    case 'milestone': return { times: [{ at: item.at, source: 'server' }], detail: `Departed ${context.stopName}${item.sealNumber ? ` · Seal ${item.sealNumber}` : ''}` }
    case 'absent': return { times: [{ at: null, source: null }], detail: `${EVIDENCE_ROLE_NOUN[item.role]} · Not submitted at completion` }
    case 'expected': return { times: [], detail: expectedLabel(item, context.phase.phase_type, context.destinationName, context.expectedArrivalAt) }
    case 'anchor': return null
  }
}

function CompactRow({ item, context, connectToNext = false }: ItemProps) {
  if (item.kind === 'exception') {
    const exception = context.exceptionsById.get(item.exceptionId)
    return exception ? <li data-row-kind="exception" className={COMPACT_SUBGRID}><ExceptionRow exception={exception} at={item.at} phaseId={context.phase.phase_event_id}
      selected={exception.id === context.selectedExceptionId} highlighted={exception.id === context.highlightedExceptionId}
      onOpen={context.onOpenException} density="compact" connectToNext={connectToNext} /></li> : null
  }
  if (item.kind === 'trip_event') {
    return <li data-row-kind={item.event.kind} className={COMPACT_SUBGRID}>
      <TripEventRow act={item} handlers={context.tripEvents ?? NO_TRIP_EVENT_HANDLERS} density="compact" connectToNext={connectToNext} />
    </li>
  }
  const record = compactRecord(item, context)
  if (record === null) return null
  const kind = item.kind === 'evidence_group' ? 'evidence' : item.kind
  return <li data-row-kind={kind} className={COMPACT_SUBGRID}>
    <CompactActLine times={record.times} icon={KIND_ICON[kind]} connectToNext={connectToNext}><NumericText text={record.detail} /></CompactActLine>
  </li>
}

/** One rail entry for one item, or null when there is nothing to draw (a row for an exception
 *  the page no longer has). The anchor row is wrapped whole in `ForensicOnly`, so with forensic
 *  mode off not even its icon is drawn (D32). */
export function ActRow({ item, context, highlighted, density = 'full', nested = false, connectToNext = false }: ItemProps) {
  if (density === 'compact') return <CompactRow item={item} context={context} highlighted={false} connectToNext={connectToNext} />
  if (nested && item.kind === 'evidence_group') return <li data-row-kind="evidence" className="pb-3"><EvidenceGroupRow group={item} phaseType={context.phase.phase_type} lookup={context.lookup} /></li>
  switch (item.kind) {
    case 'evidence_group':
      return <RailRow kind="evidence" highlighted={highlighted}><EvidenceGroupRow group={item} phaseType={context.phase.phase_type} lookup={context.lookup} /></RailRow>
    case 'milestone':
      return <RailRow kind="milestone" highlighted={highlighted}><MilestoneBody act={item} stopName={context.stopName} /></RailRow>
    case 'completion':
      return <RailRow kind="completion" highlighted={highlighted}><CompletionBody act={item} context={context} /></RailRow>
    case 'absent':
      return <RailRow kind="absent" highlighted={highlighted}><AbsentBody act={item} /></RailRow>
    case 'expected':
      return <RailRow kind="expected" highlighted={false}><ExpectedBody act={item} context={context} /></RailRow>
    case 'anchor':
      return <ForensicOnly><RailRow kind="anchor" highlighted={false}><AnchorBody act={item} /></RailRow></ForensicOnly>
    case 'trip_event':
      return <RailRow kind={item.event.kind} highlighted={highlighted}>
        <TripEventRow act={item} handlers={context.tripEvents ?? NO_TRIP_EVENT_HANDLERS} />
      </RailRow>
    case 'exception': {
      const exception = context.exceptionsById.get(item.exceptionId)
      if (!exception) return null
      const row = <ExceptionRow
            exception={exception}
            at={item.at}
            phaseId={context.phase.phase_event_id}
            selected={exception.id === context.selectedExceptionId}
            highlighted={exception.id === context.highlightedExceptionId}
            onOpen={context.onOpenException}
          />
      return <RailRow kind="exception" highlighted={false}>{row}</RailRow>
    }
  }
}
