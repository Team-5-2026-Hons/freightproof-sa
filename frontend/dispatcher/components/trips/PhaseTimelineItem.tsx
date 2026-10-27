'use client'

import { useState, useId, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseNodeType } from '@/lib/phase/derive'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'

export const PHASE_ANCHOR_PREFIX = 'phase-'
export const TIMELINE_TOOLBAR_HEIGHT_VAR = '--timeline-toolbar-height'

export const NODE_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-ok text-white',
  active:  'bg-sec text-white motion-safe:animate-pulse',
  next:    'bg-surf-lowest text-sec border-2 border-sec',
  warn:    'bg-warn-c text-warn-onc',
  pending: 'bg-surf-high text-on-surf-v border border-outline-v',
}

export const LINE_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-ok/40',
  active:  'bg-outline-v/30',
  next:    'bg-outline-v/30',
  warn:    'bg-outline-v/30',
  pending: 'bg-outline-v/30',
}

export const CARD_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-surf-low',
  active:  'bg-sec-c border border-sec/20',
  next:    'bg-surf-low border border-sec/30',
  warn:    'bg-surf-low',
  pending: 'border border-dashed border-outline-v/40',
}

interface Props {
  id?: string; label: string; meta: string; timestamp: string | null
  nodeType: PhaseNodeType; number: number; initialOpen: boolean; cancelled: boolean
  overridden: boolean; children?: ReactNode; warning?: string
  isLast: boolean
  alwaysOpen?: boolean
  verdict?: ReactNode
  collapsedContent?: ReactNode
  collapsedVerdict?: ReactNode
  openRequestId?: number | null
  live?: boolean
}

interface RailColumnProps {
  nodeType: PhaseNodeType; number: number | null; overridden: boolean; isLast: boolean
  live?: boolean
}

/** The node and the rail line below it, shared by the Evidence cards and the minimised cards so
 *  the two views line up. A null number is the Trip record, which has no sequence. */
export function PhaseRailColumn({ nodeType, number, overridden, isLast, live = false }: RailColumnProps) {
  return <div className="flex shrink-0 flex-col items-center">
    <div data-node-type={nodeType} data-live={live ? 'true' : undefined} className={`relative flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-meta font-bold ${NODE_STYLE[nodeType]}`}>
      {number === null ? <Ic n="file" s={14} /> : nodeType === 'done' && !overridden ? <Ic n="check" s={14} className="text-white" /> : number}
      {live && <><span aria-hidden="true" data-live-ring className="pointer-events-none absolute -inset-1 rounded-full border-2 border-sec motion-safe:animate-pulse" /><span className="sr-only">Live</span></>}
    </div>
    {!isLast && <div className={`my-1 min-h-[20px] w-0.5 flex-1 ${LINE_STYLE[nodeType]}`} />}
  </div>
}

/** A phase's recorded time, as the card header and the minimised card both show it. */
export function PhaseClock({ timestamp, label }: { timestamp: string; label?: string }) {
  return <time dateTime={timestamp} aria-label={label} className="flex items-center gap-[4px] text-meta font-bold tabular-nums text-sec">
    <Ic n="clock" s={11} className="text-sec" />{fmtDateTime(timestamp)}
  </time>
}

/** The chip a card with no verdict wears. */
function statusChip(nodeType: PhaseNodeType, cancelled: boolean, overridden: boolean): string | null {
  if (overridden) return 'Unable to complete'
  if (cancelled && (nodeType === 'next' || nodeType === 'pending')) return 'Not reached'
  if (nodeType === 'warn') return 'Exception'
  if (nodeType === 'active') return 'In progress'
  if (nodeType === 'next') return 'Current phase'
  return nodeType === 'pending' ? 'Not started' : null
}

export function PhaseTimelineItem({
  id, label, meta, timestamp, nodeType, number, initialOpen, cancelled,
  overridden, children, warning, isLast, alwaysOpen = false, verdict, collapsedContent, collapsedVerdict, openRequestId = null, live = false,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(initialOpen)
  const [seenRequest, setSeenRequest] = useState<number | null>(null)
  if (openRequestId !== seenRequest) {
    setSeenRequest(openRequestId)
    if (openRequestId !== null) setOpen(true)
  }
  const contentId = useId()
  const expandable = !!children && !alwaysOpen
  const status = verdict ? null : statusChip(nodeType, cancelled, overridden)

  const summaryContent = <>
    <div className="mb-[5px] flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        <h3 className={`text-title ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>{label}</h3>
        {status && <Chip type={nodeType === 'warn' ? 'exception' : 'pending'} label={status} />}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {timestamp && <PhaseClock timestamp={timestamp} />}
        {expandable && <Ic n="chev" s={14} className={`text-on-surf-v transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />}
      </div>
    </div>
    {meta && <div className="text-label font-medium text-on-surf-v">{meta}</div>}
    {open || alwaysOpen ? verdict : collapsedVerdict ?? verdict}
  </>

  return <div id={id} style={{ scrollMarginTop: `var(${TIMELINE_TOOLBAR_HEIGHT_VAR}, 0px)` }} className="relative flex min-w-0 gap-[14px]">
    <PhaseRailColumn nodeType={nodeType} number={number} overridden={overridden} isLast={isLast} live={live} />
    <div className="mb-3 min-w-0 flex-1">
      <div className={`rounded-lg px-4 py-3 ${CARD_STYLE[nodeType]} ${expandable ? 'transition-shadow duration-150 hover:shadow-md' : ''}`}>
        {expandable ? <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }} className="block w-full select-none rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">{summaryContent}</button> : summaryContent}
        {!open && !alwaysOpen && collapsedContent}
        {warning && <p className="mt-3 text-body font-semibold text-warn">{warning}</p>}
        {children && (alwaysOpen || open) && <div id={alwaysOpen ? undefined : contentId}>{children}</div>}
      </div>
    </div>
  </div>
}
