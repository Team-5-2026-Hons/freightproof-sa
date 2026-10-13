'use client'

import type { ReactNode } from 'react'
import { Ic, type IconName } from '@/components/ui/Ic'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import {
  absentLabel, anchorLabel, completionTimeLine, completionTitle, completionValueLines, expectedLabel,
} from '@/lib/phase/act-wording'
import type { AbsentAct, AnchorAct, CompletionAct, ExpectedAct, MilestoneAct } from '@/lib/phase/acts'
import type { ActItem } from '@/lib/phase/act-groups'
import { EvidenceGroupRow, type EvidenceLookup } from './EvidenceGroupRow'
import { NumericText } from './NumericText'
import { ExceptionRow, type OpenException } from './ExceptionRow'

type RailKind = 'evidence' | 'milestone' | 'completion' | 'exception' | 'absent' | 'anchor' | 'expected' | 'more'
type Tone = 'ok' | 'warn' | 'err' | 'neutral' | 'chain'

const KIND_ICON: Record<RailKind, IconName> = {
  evidence: 'cam', milestone: 'truck', completion: 'check', exception: 'warn', absent: 'cam', anchor: 'hex', expected: 'clock', more: 'plus',
}
const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok', warn: 'text-warn', err: 'text-err', neutral: 'text-on-surf-v', chain: 'text-chain',
}
const KIND_TONE: Partial<Record<RailKind, Tone>> = { completion: 'ok', exception: 'warn', anchor: 'chain' }

const HEADLINE = 'text-body font-semibold text-on-surf'
const DETAIL = 'text-body text-on-surf-v'
const TIME = 'text-meta font-semibold tabular-nums tracking-[0.03em] text-on-surf-v'
const HIGHLIGHT = 'bg-sec-c/60 motion-safe:transition-colors motion-safe:duration-700'

/** What a row needs from the card around it. Grouped so the row components stay at a few props. */
export interface ActRowContext {
  phase: PhaseDescriptor
  /** The stop this phase is anchored to; for in_transit, the one it departs from. */
  stopName: string
  destinationName: string
  expectedArrivalAt: string | null
  lookup: EvidenceLookup
  exceptionsById: ReadonlyMap<string, TripException>
  selectedExceptionId: string | null
  highlightedExceptionId: string | null
  onOpenException: OpenException
}

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
      <p className={TIME}>Recorded {fmtDateTime(act.at)} (server clock)</p>
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
}

/** One rail entry for one item, or null when there is nothing to draw (a row for an exception
 *  the page no longer has). The anchor row is wrapped whole in `ForensicOnly`, so with forensic
 *  mode off not even its icon is drawn (D32). */
export function ActRow({ item, context, highlighted }: ItemProps) {
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
    case 'exception': {
      const exception = context.exceptionsById.get(item.exceptionId)
      if (!exception) return null
      return (
        <RailRow kind="exception" highlighted={false}>
          <ExceptionRow
            exception={exception}
            at={item.at}
            phaseId={context.phase.phase_event_id}
            selected={exception.id === context.selectedExceptionId}
            highlighted={exception.id === context.highlightedExceptionId}
            onOpen={context.onOpenException}
          />
        </RailRow>
      )
    }
  }
}
